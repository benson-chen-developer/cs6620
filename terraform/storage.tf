# Look up AWS account ID for making bucket name unique
data "aws_caller_identity" "current" {}

# Store images in ECR
resource "aws_ecr_repository" "dashboard" {
  name         = "pentest-dashboard"
  force_delete = true # Lets "terraform destroy" remove it even if it holds images
}

resource "aws_ecr_repository" "worker" {
  name         = "pentest-worker"
  force_delete = true # Lets "terraform destroy" remove it even if it holds images
}

# SQS
# Dead letter queue
resource "aws_sqs_queue" "scan_jobs_dlq" {
  name                      = "pentest-scan-jobs-dlq"
  message_retention_seconds = 1209600 # Keep failed jobs 14 days (the maximum) for inspection
}

# Job queue
resource "aws_sqs_queue" "scan_jobs" {
  name                       = "pentest-scan-jobs"
  visibility_timeout_seconds = 900 # Hide jobs for 15 minutes while a worker has it
  receive_wait_time_seconds  = 20  # Set default wait time for worker polling

  # Move the job to DLQ after 3 failed attempts
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.scan_jobs_dlq.arn
    maxReceiveCount     = 3
  })
}

# S3
resource "aws_s3_bucket" "reports" {
  bucket        = "pentest-reports-${data.aws_caller_identity.current.account_id}"
  force_destroy = true # Lets "terraform destroy" delete the bucket even if it holds reports
}

# Restrict public access to S3 bucket
resource "aws_s3_bucket_public_access_block" "reports" {
  bucket                  = aws_s3_bucket.reports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}