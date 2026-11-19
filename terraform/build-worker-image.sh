#!/bin/bash
# Builds the worker image and pushes it to ECR. Run by Terraform
# (terraform_data.worker_image in ecs.tf); needs REGION, REPO_URL, TAG, REPO_ROOT.
set -euo pipefail

REGISTRY="${REPO_URL%%/*}"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"

# Fargate runs on x86, so build for amd64 even on Apple Silicon.
# The worker's Dockerfile is in worker/, so that folder is the build context.
docker build --platform linux/amd64 -t "$REPO_URL:$TAG" "$REPO_ROOT/worker"
docker push "$REPO_URL:$TAG"