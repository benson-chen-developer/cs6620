# SNS topic for scan alerts. The worker publishes here when a scan finds a
# serious failure (with a "targetId" message attribute). Each user's email is
# subscribed to this topic with a filter policy so they only get alerts for
# their own targets.
resource "aws_sns_topic" "alerts" {
  name = "pentest-alerts"
}
