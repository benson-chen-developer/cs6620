# This file runs the provided test-target.js on an EC2 instance
# so that the workers have an API to scan against.

# AMI for instance
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023*-x86_64"]
  }
}

# EC2 instance
resource "aws_instance" "test_target" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public_a.id
  private_ip             = "10.0.1.50" # Fixed for testing against the API
  vpc_security_group_ids = [aws_security_group.test_target.id]

  # Startup script, with the test target's code passed in from the repo
  user_data = templatefile("${path.module}/test-target-setup.sh", {
    package_json_b64   = base64encode(file("${path.module}/../pentest/backend/package.json"))
    test_target_js_b64 = base64encode(file("${path.module}/../pentest/backend/test-target.js"))
  })
  user_data_replace_on_change = true # Rebuild the instance if the startup script or code changes

  tags = {
    Name = "pentest-test-target"
  }
}