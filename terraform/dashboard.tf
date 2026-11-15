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
    image             = "${aws_ecr_repository.dashboard.repository_url}:latest"
    targets_table     = aws_dynamodb_table.targets.name
    scans_table       = aws_dynamodb_table.scans.name
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