output "scan_jobs_queue_url" {
  value = aws_sqs_queue.scan_jobs.url
}

output "reports_bucket" {
  value = aws_s3_bucket.reports.bucket
}

output "worker_repository_url" {
  value = aws_ecr_repository.worker.repository_url
}

output "dashboard_repository_url" {
  value = aws_ecr_repository.dashboard.repository_url
}