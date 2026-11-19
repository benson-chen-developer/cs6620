output "scan_jobs_queue_url" {
  value = aws_sqs_queue.scan_jobs.url
}

output "reports_bucket" {
  value = data.aws_s3_bucket.reports.id
}

output "worker_repository_url" {
  value = aws_ecr_repository.worker.repository_url
}

output "dashboard_repository_url" {
  value = aws_ecr_repository.dashboard.repository_url
}
output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "dashboard_url" {
  value = "http://${aws_eip.dashboard.public_ip}"
}
