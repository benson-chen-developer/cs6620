#!/bin/bash
# Stop immediately if any command fails, print each command
# before running it, and the whole thing fails if any line fails
set -euxo pipefail

# Install and start Docker
dnf install -y docker
systemctl enable --now docker

# Find this instance's ID (from the instance metadata service)
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)

# Attach the dashboard's Elastic IP to this instance
aws ec2 associate-address --region ${region} --allocation-id ${eip_allocation_id} --instance-id "$INSTANCE_ID" --allow-reassociation

# Log in to ECR, then pull and run the dashboard image
aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${registry}

docker run -d --restart always --name dashboard -p 80:3001 \
  -e AWS_REGION=${region} \
  -e TARGETS_TABLE=${targets_table} \
  -e SCANS_TABLE=${scans_table} \
  -e REPORTS_BUCKET=${reports_bucket} \
  --log-driver=awslogs \
  --log-opt awslogs-group=${log_group} \
  --log-opt awslogs-region=${region} \
  ${image}