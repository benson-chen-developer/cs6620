resource "aws_dynamodb_table" "targets" {
  name         = "targets" #name of dynamodb table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "targetId" #unique key

  attribute {
    name = "targetId"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "nextRunAt"
    type = "S"
  }

  attribute {
    name = "ownerId"
    type = "S"
  }

  # GSI: Alternate way to look up items in table. We sort 
  # based on active apis and when their next scheduled 
  # runs are. We want to query for the next closest runs instead of 
  # all of them.
  global_secondary_index { 
    name            = "status-nextRunAt-index"
    hash_key        = "status"
    range_key       = "nextRunAt"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "ownerId-index" #user who uploaded this
    hash_key        = "ownerId"
    projection_type = "ALL"
  }
}

# Table for all the scans
resource "aws_dynamodb_table" "scans" {
  name         = "scans"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "targetId"
  range_key    = "scanId"
 
  # targetId+scanId makes up a primary key
  attribute {
    name = "targetId"
    type = "S"
  }

  attribute {
    name = "scanId"
    type = "S"
  }
}