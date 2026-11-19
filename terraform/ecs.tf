# This file runs the containers on ECS Fargate

# LabRole, used to give container permission to call AWS services
locals {
  lab_role_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/LabRole"
}

# ECS cluster
resource "aws_ecs_cluster" "main" {
  name = "pentest-cluster"
}

# CloudWatch log group used for logging from container to CloudWatch
resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/pentest-worker"
  retention_in_days = 7 # Delete logs after a week
}

# Worker task definition
resource "aws_ecs_task_definition" "worker" {
  family                   = "pentest-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = local.lab_role_arn # Used by ECS to pull the image and write logs
  task_role_arn            = local.lab_role_arn # Used by the worker image to call SQS, DynamoDB, S3

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = "${aws_ecr_repository.worker.repository_url}:latest"
      essential = true

      # Environment variables
      environment = [
        { name = "QUEUE_URL", value = aws_sqs_queue.scan_jobs.url },
        { name = "REPORTS_BUCKET", value = data.aws_s3_bucket.reports.id },
        { name = "TARGETS_TABLE", value = aws_dynamodb_table.targets.name },
        { name = "SCANS_TABLE", value = aws_dynamodb_table.scans.name },
        { name = "SNS_TOPIC_ARN", value = aws_sns_topic.alerts.arn },
        { name = "AWS_REGION", value = "us-east-1" }
      ]

      # Set up logging to CloudWatch
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = "us-east-1"
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])
}

# Create ECS worker
resource "aws_ecs_service" "worker" {
  name            = "pentest-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.public_a.id, aws_subnet.public_b.id]
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = true # Needed to reach the internet, since there's no NAT Gateway
  }
}