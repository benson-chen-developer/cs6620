# Pentest Scheduling Platform

An API penetration testing platform on AWS. Users register their APIs on a web dashboard and choose how often to scan them. A scheduler queues scans when they're due, a worker runs the provided pentest tool against each API, and the results are stored and shown in the dashboard.

Commands are given for **Bash (Linux/macOS, or Git Bash on Windows)** and **PowerShell (Windows)** where they differ.

---

## Architecture

| Component                                     | AWS service                                                             | Code                                            |
| --------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| Dashboard (React UI + Express API)            | EC2 in an Auto Scaling group of 1, with an Elastic IP                   | `web/`, `api/`, `Dockerfile.dashboard`          |
| Scan worker                                   | ECS Fargate                                                             | `worker/`                                       |
| Scheduler (queues due scans every 15 minutes) | Lambda + EventBridge                                                    | `scheduler/`                                    |
| Job queue + dead-letter queue                 | SQS                                                                     | `terraform/storage.tf`                          |
| Targets and scan summaries                    | DynamoDB (`targets`, `scans`)                                           | `terraform/dynamodb.tf`                         |
| Full scan reports                             | S3 (`pentest-reports-<account-id>`)                                     | created by hand, see setup                      |
| Container images                              | ECR (`pentest-worker`, `pentest-dashboard`)                             | built and pushed by Terraform                   |
| Test target (deliberately vulnerable API)     | EC2, private IP `10.0.1.50`                                             | `pentest/backend/test-target.js`                |
| Network                                       | VPC, two public subnets, security groups, S3/DynamoDB gateway endpoints | `terraform/network.tf`, `terraform/security.tf` |

`terraform apply` builds both Docker images on your machine and pushes them to ECR, so there are no manual image steps.

---

## Prerequisites

- **AWS Academy Learner Lab** session started
- **AWS CLI** v2
- **Terraform** (recent version)
- **Docker Desktop**, running (Terraform uses it to build the images)
- **Bash**: built in on Linux/macOS. On Windows, **Git Bash** must be the `bash` on your `PATH` (see below)

### Load Learner Lab credentials

At the start of every lab session, using the values from the Learner Lab's **AWS Details** panel:

```bash
aws configure                                    # access key, secret key, region us-east-1
aws configure set aws_session_token <SESSION_TOKEN>
aws sts get-caller-identity                      # should print your account ID
```

### Windows only: make sure `bash` is Git Bash

Terraform runs the image build scripts with `bash`. If WSL is installed, `bash` may start WSL instead, which doesn't receive the settings Terraform passes to the scripts.

```powershell
Get-Command bash
```

If it doesn't point to Git (for example `C:\Program Files\Git\bin\bash.exe`), put Git Bash first for the current window:

```powershell
$env:Path = "C:\Program Files\Git\bin;" + $env:Path
```

This lasts until the window is closed, so repeat it in each new window before running Terraform.

---

## One-time setup: the S3 reports bucket

Learner Lab blocks a bucket setting (object lock) that Terraform's `aws_s3_bucket` resource always reads, so the bucket is created once by hand, and Terraform only looks it up. `terraform destroy` never deletes it.

**Bash**

```bash
aws s3api create-bucket --bucket "pentest-reports-$(aws sts get-caller-identity --query Account --output text)" --region us-east-1
```

**PowerShell**

```powershell
aws s3api create-bucket --bucket "pentest-reports-$(aws sts get-caller-identity --query Account --output text)" --region us-east-1
```

New buckets block all public access by default.

---

## Deploy

From the `terraform/` folder, with Docker Desktop running:

```bash
cd terraform
terraform init
terraform apply
terraform output
```

`apply` takes several minutes, mostly building the two images. It creates the network, queues, tables, and ECR repositories, builds and pushes both images, and starts the worker, dashboard, and test target.

The outputs:

| Output                | Used for                    |
| --------------------- | --------------------------- |
| `dashboard_url`       | Opening the dashboard       |
| `scan_jobs_queue_url` | Sending jobs by hand        |
| `reports_bucket`      | Checking reports            |
| `test_target_url`     | Registering the test target |

> **The worker, dashboard, test target, and Elastic IP cost money every hour they run.** Run `terraform destroy` when you're done.

### Check it's running

The dashboard and test target take a few minutes after `apply` to boot and run their startup scripts.

**Worker:**

```bash
aws ecs describe-services --cluster pentest-cluster --services pentest-worker --query "services[0].[desiredCount,runningCount]"
aws logs tail /ecs/pentest-worker --since 15m
```

Should show `[1, 1]` and `Worker started. Polling ...`.

**Dashboard:** open `dashboard_url` in a browser. Container logs:

```bash
aws logs tail /pentest/dashboard --since 15m
```

Should show `Pentest scheduling API listening on port 3001`.

**Test target:** in the console, **EC2 → `pentest-test-target` → Actions → Monitor and troubleshoot → Get system log** should end with `Cloud-init ... finished`. It's only reachable from inside the VPC, so it can't be opened from your laptop.

---

## Test a scan

This registers the test target, sends it a scan job by hand (instead of waiting for the scheduler), and checks the results. Replace `<DASHBOARD_URL>` with the `dashboard_url` output.

### 1. Register the test target

**Bash**

```bash
curl -X POST "<DASHBOARD_URL>/targets" \
  -H "Content-Type: application/json" \
  -d '{"url":"http://10.0.1.50:4000/api/users","frequency":"daily","email":"test@example.com"}'
```

**PowerShell**

```powershell
Invoke-RestMethod -Method Post -Uri "<DASHBOARD_URL>/targets" `
  -ContentType "application/json" `
  -Body '{"url":"http://10.0.1.50:4000/api/users","frequency":"daily","email":"test@example.com"}'
```

Copy the `targetId` from the response. (You can also use the dashboard's form.)

### 2. Send a scan job

Use the `scan_jobs_queue_url` output, the `targetId`, and a new `scanId` (any ISO timestamp) for each scan.

**Bash**

```bash
aws sqs send-message --queue-url <QUEUE_URL> \
  --message-body '{"targetId":"<TARGET_ID>","scanId":"2026-11-20T15:00:00Z","url":"http://10.0.1.50:4000/api/users","trigger":"manual"}'
```

**PowerShell** (Windows PowerShell 5.1 strips quotes from JSON passed to the AWS CLI, so each quote is escaped)

```powershell
aws sqs send-message --queue-url <QUEUE_URL> --message-body '{\"targetId\":\"<TARGET_ID>\",\"scanId\":\"2026-11-20T15:00:00Z\",\"url\":\"http://10.0.1.50:4000/api/users\",\"trigger\":\"manual\"}'
```

### 3. Watch the worker

```bash
aws logs tail /ecs/pentest-worker --follow
```

Within a few seconds:

```
Scanning http://10.0.1.50:4000/api/users (scan 2026-11-20T15:00:00Z, attempt 1)
Finished scan 2026-11-20T15:00:00Z: 3 failed.
```

### 4. Check the results

- **S3:** the full report at `reports/<TARGET_ID>/<SCAN_ID>.json` in the reports bucket
- **DynamoDB:** a row in the `scans` table with `status: done`, `counts`, `failedTests`, and `reportKey`
- **Dashboard:** the **Scans** tab, with `test@example.com` selected

---

## Update a running deployment

After changing any code (worker, API, React app, or Terraform):

```bash
cd terraform
terraform apply
```

Terraform fingerprints each image's source files. If they changed, it rebuilds and pushes the image, and then:

- **Worker:** ECS replaces the running task with one using the new image.
- **Dashboard:** the Auto Scaling group replaces the instance (a few minutes of downtime).

---

## Local development

Uses the real DynamoDB tables, queue, and bucket in AWS, so deploy first. Load Learner Lab credentials in each terminal.

| What                              | Folder             | Command                                  | Address                                          |
| --------------------------------- | ------------------ | ---------------------------------------- | ------------------------------------------------ |
| API                               | `api/`             | `npm install` then `npm start`           | `http://localhost:3001`                          |
| React app (needs the API running) | `web/`             | `npm install` then `npm run dev`         | printed by Vite, usually `http://localhost:5173` |
| Test target                       | `pentest/backend/` | `npm install` then `node test-target.js` | `http://localhost:4000`                          |

The API needs `REPORTS_BUCKET` set to your bucket name (from `terraform output`) for report pages to work:

- Bash: `REPORTS_BUCKET=<reports_bucket> npm start`
- PowerShell: `$env:REPORTS_BUCKET = "<reports_bucket>"` then `npm start`

---

## Shut down

```bash
cd terraform
terraform destroy
```

This deletes everything Terraform created, including the images, tables (and their data), queues, and instances. The S3 reports bucket and its reports remain.

To clear old reports, or delete the bucket at the end of the semester:

```bash
aws s3 rm s3://pentest-reports-<ACCOUNT_ID>/reports/ --recursive
aws s3 rb s3://pentest-reports-<ACCOUNT_ID> --force
```

---

## Troubleshooting

**`<script>: line 6: REPO_URL: unbound variable` during `apply` (Windows)**
`bash` is WSL instead of Git Bash, so the build scripts didn't receive their settings. Put Git Bash first on your `PATH` (see Prerequisites), then run `terraform apply` again.

**An image build fails during `apply`**
Make sure Docker Desktop is running, then run `terraform apply` again. Anything already created is kept.

**`Error: reading S3 Bucket ... GetObjectLockConfiguration ... explicit deny`**
Learner Lab forbids that read. The bucket must be created by hand (see One-time setup), with Terraform using `data "aws_s3_bucket"`.

**`data.aws_s3_bucket.reports`: bucket not found**
The reports bucket hasn't been created in this account. See One-time setup.

**The dashboard doesn't load after 5+ minutes**
Check its system log (**EC2 → `pentest-dashboard` → Actions → Monitor and troubleshoot → Get system log**) for the step where the startup script failed. After fixing the cause, start a fresh instance:

```bash
aws autoscaling start-instance-refresh --auto-scaling-group-name pentest-dashboard
```

**`'charmap' codec can't encode character` when printing a system log (Windows)**
Run `$env:PYTHONUTF8 = "1"` in that PowerShell window, then retry.

**A startup script fails with `set: pipefail\r: invalid option`**
The `.sh` file has Windows (CRLF) line endings. In VS Code, click `CRLF` in the bottom-right status bar, choose `LF`, and save. `.gitattributes` keeps `.sh` files as LF in Git.

**`terraform apply` fails mentioning an ECS service-linked role**
AWS sets this role up the first time ECS is used in an account. Run `terraform apply` again.

**JSON sent from PowerShell arrives without its quotes**
Windows PowerShell strips double quotes from arguments passed to programs like `aws`. Use `Invoke-RestMethod` for API calls, and escape quotes as `\"` for the AWS CLI.

---

## Known limitations

- **No user accounts.** Users are identified only by email, so anyone who knows an email can see that user's targets.
- **The S3 bucket is created outside Terraform,** because of Learner Lab's restrictions.
- **Broad permissions.** Every component uses Learner Lab's shared `LabRole`. In production, each would have its own least-privilege role.
- **No NAT Gateway.** Workers run in public subnets (with a security group that allows no inbound traffic) to avoid NAT costs. In production, they would run in private subnets.
- **HTTP only.** The dashboard has no TLS certificate.
