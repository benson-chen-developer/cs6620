# This file runs the dashboard (Express API + React) on EC2
# with an Auto Scaling group that replaces the instance if it fails.

# Elastic IP for the dashboard
resource "aws_eip" "dashboard" {
  domain = "vpc"

  tags = {
    Name = "pentest-dashboard-eip"
  }
}

# CloudWatch log group used for logging from container to CloudWatch
resource "aws_cloudwatch_log_group" "dashboard" {
  name              = "/pentest/dashboard"
  retention_in_days = 7
}

# Tag the image with a hash of its source files. When the UI or API changes, the
# tag changes, which rebuilds + pushes the image and (through the launch
# template below) rolls the dashboard instance onto the new image.
locals {
  repo_root = "${path.module}/.."
  dashboard_source_files = setunion(
    fileset(local.repo_root, "web/src/**"),
    fileset(local.repo_root, "api/*.js"),
    toset([
      "Dockerfile.dashboard",
      "web/index.html",
      "web/package.json",
      "web/package-lock.json",
      "web/vite.config.js",
      "api/package.json",
      "api/package-lock.json",
    ])
  )
  dashboard_tag = substr(sha1(join("", [
    for f in sort(tolist(local.dashboard_source_files)) : filesha1("${local.repo_root}/${f}")
  ])), 0, 12)
}

# Builds the dashboard image (React UI + Express API) and pushes it to ECR.
# Needs Docker running, the AWS CLI configured, and bash (Git Bash on Windows).
resource "terraform_data" "dashboard_image" {
  triggers_replace = [local.dashboard_tag, aws_ecr_repository.dashboard.repository_url]

  provisioner "local-exec" {
    interpreter = ["bash", "-c"]
    command     = "${path.module}/build-dashboard-image.sh"
    environment = {
      REGION    = "us-east-1"
      REPO_URL  = aws_ecr_repository.dashboard.repository_url
      TAG       = local.dashboard_tag
      REPO_ROOT = local.repo_root
    }
  }
}

# Launch template for dashboard image
resource "aws_launch_template" "dashboard" {
  name_prefix            = "pentest-dashboard-"
  image_id               = data.aws_ami.al2023.id # Defined in test-target.tf
  instance_type          = "t3.micro"
  vpc_security_group_ids = [aws_security_group.dashboard.id]

  # Lets the instance call AWS services (ECR, DynamoDB, S3, Elastic IP)
  iam_instance_profile {
    name = "LabInstanceProfile"
  }

  # Startup script
  user_data = base64encode(templatefile("${path.module}/dashboard-setup.sh", {
    region            = "us-east-1"
    eip_allocation_id = aws_eip.dashboard.allocation_id
    registry          = split("/", aws_ecr_repository.dashboard.repository_url)[0]
    image             = "${aws_ecr_repository.dashboard.repository_url}:${terraform_data.dashboard_image.triggers_replace[0]}"
    targets_table     = aws_dynamodb_table.targets.name
    scans_table       = aws_dynamodb_table.scans.name
    reports_bucket    = data.aws_s3_bucket.reports.id
    alerts_topic_arn  = aws_sns_topic.alerts.arn
    log_group         = aws_cloudwatch_log_group.dashboard.name
  }))

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "pentest-dashboard"
    }
  }
}

# Auto scaling group to always keep an instance of the dashboard running
resource "aws_autoscaling_group" "dashboard" {
  name                      = "pentest-dashboard"
  min_size                  = 1
  max_size                  = 1
  desired_capacity          = 1
  vpc_zone_identifier       = [aws_subnet.public_a.id, aws_subnet.public_b.id]
  health_check_type         = "EC2"
  health_check_grace_period = 300 # Give a new instance 5 minutes to boot before checking it

  launch_template {
    id      = aws_launch_template.dashboard.id
    version = "$Latest"
  }

  # Replace the instance if the launch template changes
  instance_refresh {
    strategy = "Rolling"
    preferences {
      # What percent of instances must be running, there's only 1 instance
      # so it has to be set at 0
      min_healthy_percentage = 0
    }
  }
}