#!/bin/bash
# Builds the dashboard image and pushes it to ECR. Run by Terraform
# (terraform_data.dashboard_image in dashboard.tf); needs REGION, REPO_URL, TAG, REPO_ROOT.
set -euo pipefail

REGISTRY="${REPO_URL%%/*}"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"

# The dashboard runs on x86 EC2, so build for amd64 even on Apple Silicon.
docker build --platform linux/amd64 -f "$REPO_ROOT/Dockerfile.dashboard" -t "$REPO_URL:$TAG" "$REPO_ROOT"
docker push "$REPO_URL:$TAG"
