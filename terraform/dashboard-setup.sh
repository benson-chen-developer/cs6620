#!/bin/bash
# Stop immediately if any command fails, print each command
# before running it, and the whole thing fails if any line fails
set -euxo pipefail

# Retry a command up to 5 times, 10 seconds apart, for steps that use the network
retry() {
  for attempt in 1 2 3 4 5; do
    "$@" && return 0
    echo "Attempt $attempt failed: $*. Retrying in 10 seconds..."
    sleep 10
  done
  return 1
}

# Install and start Docker
dnf install -y docker
systemctl enable --now docker

# Log in to ECR and pull the dashboard image, using the instance's original public IP
retry bash -c "aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${registry}"
retry docker pull ${image}

# Start the dashboard container
docker run -d --restart always --name dashboard -p 80:3001 \
  -e AWS_REGION=${region} \
  -e TARGETS_TABLE=${targets_table} \
  -e SCANS_TABLE=${scans_table} \
  -e REPORTS_BUCKET=${reports_bucket} \
  -e SNS_TOPIC_ARN=${alerts_topic_arn} \
  --log-driver=awslogs \
  --log-opt awslogs-group=${log_group} \
  --log-opt awslogs-region=${region} \
  ${image}

# Find this instance's ID (from the instance metadata service)
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)

# Attach the dashboard's Elastic IP last. Swapping public IPs briefly interrupts
# outbound connections, so it happens after everything has been downloaded.
retry aws ec2 associate-address --region ${region} --allocation-id ${eip_allocation_id} --instance-id "$INSTANCE_ID" --allow-reassociation