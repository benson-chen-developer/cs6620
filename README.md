# Pentest Scheduling Platform
 
An API penetration testing platform on AWS. Users register their APIs on a web dashboard and choose how often to scan them. The platform runs the provided pentest tool against each API on schedule, stores the results, and shows them in the dashboard.
 
Commands are given for **Bash (Linux/macOS, or Git Bash on Windows)** and **PowerShell (Windows)** wherever they differ.
 
---
 
## Architecture
 
| Component | AWS service | Code |
|---|---|---|
| Dashboard (React UI + Express API) | EC2, in an Auto Scaling group of 1, with an Elastic IP | `web/`, `api/`, `Dockerfile.dashboard` |
| Scan worker | ECS Fargate service | `worker/` |
| Scheduler (finds due targets every 15 minutes) | Lambda + EventBridge | `scheduler/` |
| Job queue + dead-letter queue | SQS | `terraform/storage.tf` |
| Targets and scan summaries | DynamoDB (`targets`, `scans`) | `terraform/dynamodb.tf` |
| Full scan reports | S3 (`pentest-reports-<account-id>`) | created by hand, see setup |
| Container images | ECR (`pentest-worker`, `pentest-dashboard`) | `terraform/storage.tf` |
| Test target (deliberately vulnerable API) | EC2, private IP `10.0.1.50` | `pentest/backend/test-target.js` |
| Network | VPC, two public subnets, security groups, S3/DynamoDB gateway endpoints | `terraform/network.tf`, `terraform/security.tf` |
 
All infrastructure is defined in Terraform, except the S3 reports bucket (see [One-time setup](#one-time-setup)).
 
---
 
## Prerequisites
 
- **AWS Academy Learner Lab** session started
- **AWS CLI** v2
- **Terraform** (recent version)
- **Docker Desktop** (running)
- **Node.js** (same major version as the Dockerfiles)
### Load Learner Lab credentials
 
Do this at the start of every lab session, since the credentials change each time. Copy the values from the Learner Lab's **AWS Details** panel.
 
```bash
aws configure                                    # access key, secret key, region us-east-1, output json
aws configure set aws_session_token <SESSION_TOKEN>
aws sts get-caller-identity                      # should print your account ID
```
 
These commands are the same in Bash and PowerShell.
 
### Save your account ID and registry (used below)
 
**Bash**
```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="$ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com"
```
 
**PowerShell**
```powershell
$ACCOUNT_ID = aws sts get-caller-identity --query Account --output text
$REGISTRY = "$ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com"
```
 
These variables only last for the current terminal window.
 
---
 
## One-time setup
 
### Create the S3 reports bucket
 
Learner Lab blocks a bucket setting (object lock) that Terraform's `aws_s3_bucket` resource always reads, so Terraform can't manage the bucket. Instead, the bucket is created once by hand, and Terraform only looks it up. `terraform destroy` never deletes it.
 
**Bash**
```bash
aws s3api create-bucket --bucket "pentest-reports-$ACCOUNT_ID" --region us-east-1
```
 
**PowerShell**
```powershell
aws s3api create-bucket --bucket "pentest-reports-$ACCOUNT_ID" --region us-east-1
```
 
New buckets block all public access by default. To confirm:
```bash
aws s3api get-public-access-block --bucket "pentest-reports-$ACCOUNT_ID"
```
All four values should be `true`.
 
---
 
## Deploy
 
The worker and dashboard both pull their Docker images from ECR when they start, so the images must be pushed **before** the rest of the infrastructure is created. The order is:
 
1. Create the ECR repositories
2. Build and push both images
3. Create everything else
All `terraform` commands are run from the `terraform/` folder. All `docker build` commands are run from the repo root.
 
### 1. Initialize and check Terraform
 
```bash
cd terraform
terraform init
terraform fmt
terraform validate
```
 
### 2. Create the ECR repositories
 
**Bash**
```bash
terraform apply -target=aws_ecr_repository.worker -target=aws_ecr_repository.dashboard
```
 
**PowerShell** (the quotes are required, or PowerShell splits the argument at the `.`)
```powershell
terraform apply '-target=aws_ecr_repository.worker' '-target=aws_ecr_repository.dashboard'
```
 
Terraform warns that `-target` is for exceptional cases. That's expected here.
 
### 3. Log Docker in to ECR
 
The login lasts 12 hours, and must be repeated after loading new Learner Lab credentials.
 
**Bash**
```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$REGISTRY"
```
 
**PowerShell** (Windows PowerShell 5.1 alters text passed through `|` to native programs, so the password is passed as an argument instead)
```powershell
docker login --username AWS --password (aws ecr get-login-password --region us-east-1) $REGISTRY
```
 
It should print `Login Succeeded`.
 
### 4. Build and push the worker image
 
From the repo root:
 
**Bash**
```bash
docker build -t pentest-worker ./worker
docker tag pentest-worker:latest "$REGISTRY/pentest-worker:latest"
docker push "$REGISTRY/pentest-worker:latest"
```
 
**PowerShell**
```powershell
docker build -t pentest-worker ./worker
docker tag pentest-worker:latest "$REGISTRY/pentest-worker:latest"
docker push "$REGISTRY/pentest-worker:latest"
```
 
### 5. Build and push the dashboard image
 
The dashboard image builds the React app (`web/`) and packages it with the Express API (`api/`) in one container. From the repo root:
 
**Bash**
```bash
docker build -f Dockerfile.dashboard -t pentest-dashboard .
docker tag pentest-dashboard:latest "$REGISTRY/pentest-dashboard:latest"
docker push "$REGISTRY/pentest-dashboard:latest"
```
 
**PowerShell**
```powershell
docker build -f Dockerfile.dashboard -t pentest-dashboard .
docker tag pentest-dashboard:latest "$REGISTRY/pentest-dashboard:latest"
docker push "$REGISTRY/pentest-dashboard:latest"
```
 
Confirm both images are in ECR:
```bash
aws ecr list-images --repository-name pentest-worker
aws ecr list-images --repository-name pentest-dashboard
```
 
### 6. Create everything else
 
```bash
cd terraform
terraform apply
terraform output
```
 
`terraform output` prints the values used below:
 
| Output | Used for |
|---|---|
| `dashboard_url` | Opening the dashboard |
| `scan_jobs_queue_url` | Sending jobs by hand |
| `reports_bucket` | Checking reports |
| `test_target_url` | Registering the test target |
| `worker_repository_url`, `dashboard_repository_url` | Pushing images |
 
> **From this point, the worker, dashboard, test target, and Elastic IP cost money every hour.** Run `terraform destroy` when you're done (see [Shut down](#shut-down)).
 
---
 
## Verify the deployment
 
### Worker
 
```bash
aws ecs describe-services --cluster pentest-cluster --services pentest-worker --query "services[0].[desiredCount,runningCount]"
```
Should show `[1, 1]`. A new task takes about a minute to start.
 
```bash
aws logs tail /ecs/pentest-worker --since 15m
```
Should show `Worker started. Polling https://sqs.us-east-1.amazonaws.com/...`.
 
### Test target
 
The instance takes a few minutes to boot and run its startup script. In the AWS console: **EC2 → Instances → `pentest-test-target` → Actions → Monitor and troubleshoot → Get system log**. Near the end, you should see `+ systemctl enable --now test-target` followed by `Cloud-init ... finished`.
 
The test target is only reachable from inside the VPC (by the workers), so it can't be opened from your laptop.
 
### Dashboard
 
Open the `dashboard_url` output in a browser. The instance takes a few minutes to boot, install Docker, and start the container.
 
Container logs:
```bash
aws logs tail /pentest/dashboard --since 15m
```
 
If the dashboard doesn't load, check the instance's system log the same way as the test target (instance name `pentest-dashboard`).
 
---
 
## Test the full pipeline
 
This registers the test target, sends it a scan job by hand (standing in for the scheduler), and checks the results.
 
### 1. Register the test target
 
**Bash**
```bash
DASHBOARD_URL=$(terraform -chdir=terraform output -raw dashboard_url)
 
curl -X POST "$DASHBOARD_URL/api/targets" \
  -H "Content-Type: application/json" \
  -d '{"url":"http://10.0.1.50:4000/api/users","frequency":"daily","email":"test@example.com"}'
```
 
**PowerShell**
```powershell
$DASHBOARD_URL = terraform -chdir=terraform output -raw dashboard_url
 
Invoke-RestMethod -Method Post -Uri "$DASHBOARD_URL/api/targets" `
  -ContentType "application/json" `
  -Body '{"url":"http://10.0.1.50:4000/api/users","frequency":"daily","email":"test@example.com"}'
```
 
Copy the `targetId` from the response. (You can also register it through the dashboard's form.)
 
### 2. Send a scan job
 
**Bash**
```bash
QUEUE_URL=$(terraform -chdir=terraform output -raw scan_jobs_queue_url)
 
aws sqs send-message --queue-url "$QUEUE_URL" \
  --message-body '{"targetId":"<TARGET_ID>","scanId":"2026-11-15T19:00:00Z","url":"http://10.0.1.50:4000/api/users","trigger":"manual"}'
```
 
**PowerShell** (PowerShell strips quotes from JSON passed to native programs, so the message goes through a file)
```powershell
$QUEUE_URL = terraform -chdir=terraform output -raw scan_jobs_queue_url
 
@'
{"targetId":"<TARGET_ID>","scanId":"2026-11-15T19:00:00Z","url":"http://10.0.1.50:4000/api/users","trigger":"manual"}
'@ | Set-Content -Encoding ascii job.json
 
aws sqs send-message --queue-url $QUEUE_URL --message-body file://job.json
Remove-Item job.json
```
 
Use a new `scanId` (any ISO timestamp) for each separate scan.
 
### 3. Watch the worker
 
```bash
aws logs tail /ecs/pentest-worker --follow
```
 
Within a few seconds:
```
Scanning http://10.0.1.50:4000/api/users (scan 2026-11-15T19:00:00Z, attempt 1)
Finished scan 2026-11-15T19:00:00Z: 3 failed.
```
 
Press `Ctrl+C` to stop following.
 
### 4. Check the results
 
**The full report in S3:**
```bash
aws s3 ls "s3://pentest-reports-$ACCOUNT_ID/reports/<TARGET_ID>/"
aws s3 cp "s3://pentest-reports-$ACCOUNT_ID/reports/<TARGET_ID>/2026-11-15T19:00:00Z.json" -
```
 
**The scan summary, through the API:**
 
Bash
```bash
curl "$DASHBOARD_URL/api/targets/<TARGET_ID>/scans"
```
 
PowerShell
```powershell
Invoke-RestMethod "$DASHBOARD_URL/api/targets/<TARGET_ID>/scans"
```
 
It should show one scan with `status: done`, its `counts`, `failedTests`, and `reportKey`.
 
**The queue is empty:**
```bash
aws sqs get-queue-attributes --queue-url "$QUEUE_URL" --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```
Both should be `"0"`.
 
---
 
## Update a running deployment
 
### Worker code changed
 
Rebuild and push the image (Deploy steps 3 and 4), then make ECS start a new task with it:
 
```bash
aws ecs update-service --cluster pentest-cluster --service pentest-worker --force-new-deployment
```
 
### Dashboard code changed (`api/` or `web/`)
 
Rebuild and push the image (Deploy steps 3 and 5). The instance only pulls the image when it boots, so replace the instance:
 
```bash
aws autoscaling start-instance-refresh --auto-scaling-group-name pentest-dashboard
```
 
The dashboard is unavailable for a few minutes while the new instance starts.
 
### Terraform changed
 
```bash
cd terraform
terraform plan
terraform apply
```
 
Changes to `dashboard-setup.sh` update the launch template, and Terraform replaces the dashboard instance automatically. Changes to `test-target-setup.sh` or `test-target.js` replace the test target instance.
 
---
 
## Local development
 
Local development uses the real DynamoDB tables, SQS queue, and S3 bucket in AWS, so deploy at least the Terraform first. Load Learner Lab credentials in each terminal.
 
### API
 
**Bash**
```bash
cd api
npm install
npm start          # http://localhost:3001
```
 
**PowerShell**
```powershell
cd api
npm install
npm start          # http://localhost:3001
```
 
### React app
 
The API must be running. Vite forwards `/api` requests to it.
 
```bash
cd web
npm install
npm run dev        # prints the local URL, usually http://localhost:5173
```
 
### Test target
 
```bash
cd pentest/backend
npm install
node test-target.js     # http://localhost:4000
```
 
### Worker
 
Get the queue URL and bucket name from `terraform output`.
 
**Bash**
```bash
cd worker
npm install
QUEUE_URL=<scan_jobs_queue_url> REPORTS_BUCKET=<reports_bucket> node worker.js
```
 
**PowerShell**
```powershell
cd worker
npm install
$env:QUEUE_URL = "<scan_jobs_queue_url>"
$env:REPORTS_BUCKET = "<reports_bucket>"
node worker.js
```
 
> If the deployed worker is also running, it competes for the same jobs. To test the local worker alone, scale the deployed one down: `aws ecs update-service --cluster pentest-cluster --service pentest-worker --desired-count 0`
 
To test the local worker against the local test target, register a target with the URL `http://localhost:4000/api/users`. The URL is just saved in DynamoDB, and the worker on your laptop is what connects to it.
 
---
 
## Shut down
 
From the `terraform/` folder:
 
```bash
terraform destroy
```
 
This deletes everything Terraform created, including the ECR images, DynamoDB tables (and their data), queues, and instances.
 
**What remains:** the S3 reports bucket and its reports, since Terraform doesn't manage it. It costs a negligible amount.
 
**Next time,** repeat the [Deploy](#deploy) steps from step 2, since the ECR repositories and images were deleted.
 
To clear old reports:
```bash
aws s3 rm "s3://pentest-reports-$ACCOUNT_ID/reports/" --recursive
```
 
To delete the bucket entirely (for example, at the end of the semester):
```bash
aws s3 rb "s3://pentest-reports-$ACCOUNT_ID" --force
```
 
---
 
## Troubleshooting
 
**`Error: reading S3 Bucket ... GetObjectLockConfiguration ... explicit deny in a service control policy`**
The code uses `resource "aws_s3_bucket"` instead of the `data` source. Learner Lab forbids that read. Create the bucket by hand (see [One-time setup](#one-time-setup)) and use `data "aws_s3_bucket"`.
 
**`data.aws_s3_bucket.reports`: bucket not found**
The reports bucket hasn't been created in this account. See [One-time setup](#one-time-setup).
 
**`Error: Invalid target "aws_ecr_repository"` (PowerShell)**
Put the `-target` argument in quotes: `'-target=aws_ecr_repository.worker'`.
 
**`docker login` fails with `400 Bad Request` (PowerShell)**
Use the PowerShell login command in Deploy step 3, which passes the password as an argument instead of through `|`.
 
**`docker push` fails with `no basic auth credentials`**
Docker isn't logged in to ECR. Run Deploy step 3 again.
 
**Worker tasks keep stopping with `CannotPullContainerError`**
The worker image isn't in ECR. Push it (Deploy step 4). ECS retries automatically and starts the task once the image exists.
 
**Dashboard instance runs, but the dashboard never loads**
Check the instance's system log. If `docker run` failed because the image wasn't found, push the dashboard image (Deploy step 5), then start an instance refresh.
 
**A startup script fails with errors like `set: pipefail\r: invalid option`**
The script has Windows (CRLF) line endings. In VS Code, open the `.sh` file, click `CRLF` in the bottom-right status bar, choose `LF`, and save. The repo's `.gitattributes` keeps `.sh` files as LF in Git.
 
**`Error: Archive creation error ... could not archive missing directory: ./../scheduler`**
`scheduler.tf` packages the `scheduler/` folder, which hasn't been pushed. Pull the latest code. To deploy without the scheduler in the meantime, temporarily rename `terraform/scheduler.tf` to `scheduler.tf.off`, and rename it back before committing.
 
**`terraform apply` fails mentioning an ECS service-linked role**
AWS sets this role up the first time ECS is used in an account. Run `terraform apply` again.
 
**JSON sent from PowerShell arrives with its quotes missing**
Windows PowerShell strips double quotes from arguments passed to native programs like `aws` and `curl.exe`. Use `Invoke-RestMethod` for API calls, or put the JSON in a file and pass it with `file://`.
 
**`curl` behaves strangely in PowerShell**
In Windows PowerShell, `curl` is an alias for `Invoke-WebRequest`. Use `Invoke-RestMethod` (as shown above), or call `curl.exe` explicitly.
 
---
 
## Known limitations
 
- **No user accounts.** Users are identified only by email (`ownerId`), so anyone who knows an email can see that user's targets.
- **The S3 bucket is created outside Terraform,** because of Learner Lab's restrictions.
- **Broad permissions.** Every component uses Learner Lab's shared `LabRole`. In production, each component would have its own least-privilege role.
- **No NAT Gateway.** Workers run in public subnets with public IPs (and a security group that allows no inbound traffic) to avoid NAT Gateway costs. In production, they would run in private subnets behind a NAT Gateway.
- **HTTP only.** The dashboard has no TLS certificate yet.