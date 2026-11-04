# Scheduler: every 15 minutes, find due targets and queue scan jobs.

# AWS Academy provides a pre-made role; we can't create IAM roles.
data "aws_iam_role" "lab_role" {
  name = "LabRole"
}

# Zip the Lambda code. The nodejs20.x runtime already includes the AWS SDK v3,
# so there is no node_modules to bundle.
data "archive_file" "scheduler" {
  type        = "zip"
  source_dir  = "${path.module}/../scheduler"
  output_path = "${path.module}/scheduler.zip"
}

resource "aws_lambda_function" "scheduler" {
  function_name    = "pentest-scheduler"
  role             = data.aws_iam_role.lab_role.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.scheduler.output_path
  source_code_hash = data.archive_file.scheduler.output_base64sha256
  timeout          = 60

  environment {
    variables = {
      TARGETS_TABLE = aws_dynamodb_table.targets.name
      QUEUE_URL     = aws_sqs_queue.scan_jobs.url
    }
  }
}

# EventBridge rule that fires on a schedule
resource "aws_cloudwatch_event_rule" "scheduler" {
  name                = "pentest-scheduler-every-15-minutes"
  schedule_expression = "rate(15 minutes)"
}

resource "aws_cloudwatch_event_target" "scheduler" {
  rule = aws_cloudwatch_event_rule.scheduler.name
  arn  = aws_lambda_function.scheduler.arn
}

# Lets EventBridge invoke the Lambda
resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.scheduler.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.scheduler.arn
}
