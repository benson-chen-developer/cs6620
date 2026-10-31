# Dashboard security group
resource "aws_security_group" "dashboard" {
  name   = "pentest-dashboard-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1" # All protocols
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "pentest-dashboard-sg"
  }
}

# Worker security group
resource "aws_security_group" "worker" {
  name   = "pentest-worker-sg"
  vpc_id = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1" # All protocols
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "pentest-worker-sg"
  }
}

# Test target security group
resource "aws_security_group" "test_target" {
  name   = "pentest-test-target-sg"
  vpc_id = aws_vpc.main.id

  # Test target ingress, used only for workers
  ingress {
    from_port       = 4000
    to_port         = 4000
    protocol        = "tcp"
    security_groups = [aws_security_group.worker.id] # Use the worker's security group
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "pentest-test-target-sg" }
}