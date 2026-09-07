# ChatVault AWS baseline: S3 + CloudFront (media), ElastiCache Redis, RDS Postgres.
# Uses the account default VPC so `terraform apply` works out of the box in dev.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

locals {
  name = "${var.project}-${var.env}"
}

/* ---------------- S3 media bucket (all access via presigned URLs) ---------------- */

resource "aws_s3_bucket" "media" {
  bucket        = "${local.name}-media"
  force_destroy = var.env == "dev" ? true : false
  tags          = { Name = local.name, Project = var.project, Env = var.env }
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.media.id
    }
  }
}

resource "aws_kms_key" "media" {
  description             = "ChatVault media encryption key"
  deletion_window_in_days = 7
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    id     = "archive-old-media"
    status = "Enabled"
    filter { prefix = "media/" }
    transitions {
      days          = 365
      storage_class = "GLACIER_IR"
    }
  }
}

/* ---------------- CloudFront CDN with OAC (signed URLs via S3 presign) ---------------- */

resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${local.name}-oac"
  description                       = "ChatVault media via CloudFront"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "media" {
  enabled             = true
  default_root_object = ""
  is_ipv6_enabled     = true
  comment             = "ChatVault media CDN"
  default_cache_behavior {
    target_origin_id       = aws_s3_bucket.media.id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized
    origin_request_policy_id = "88a5eaf4-2fd4-4709-b370-b4c650ea3fcf" # CORS-CustomOrigin
  }
  origin {
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_id                = aws_s3_bucket.media.id
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_s3_bucket_policy" "media_cloudfront" {
  bucket = aws_s3_bucket.media.id
  policy = jsonencode({
    Version = "2008-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.media.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.media.arn } }
    }]
  })
}

/* ---------------- ElastiCache Redis 7 (presence, pub/sub, tokens) ---------------- */

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${local.name}-redis"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id          = "${local.name}-redis"
  description                   = "ChatVault real-time state"
  node_type                     = var.env == "dev" ? "cache.t4g.micro" : "cache.t4g.small"
  num_cache_clusters            = var.env == "dev" ? 1 : 2
  engine                        = "redis"
  engine_version                = "7.1"
  parameter_group_name          = "default.redis7"
  subnet_group_name             = aws_elasticache_subnet_group.redis.name
  automatic_failover_enabled    = var.env != "dev"
  at_rest_encryption_enabled    = true
  transit_encryption_enabled    = true
  tags                          = { Name = local.name, Project = var.project, Env = var.env }
}

/* ---------------- RDS PostgreSQL 16 (source of truth) ---------------- */

resource "aws_db_subnet_group" "pg" {
  name       = "${local.name}-pg"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_db_instance" "pg" {
  identifier                 = "${local.name}-pg"
  engine                     = "postgres"
  engine_version             = "16.3"
  instance_class             = var.env == "dev" ? "db.t4g.micro" : "db.t4g.small"
  allocated_storage          = 20
  max_allocated_storage      = 100
  db_name                    = "chatvault"
  username                   = var.db_username
  password                   = var.db_password
  db_subnet_group_name       = aws_db_subnet_group.pg.name
  vpc_security_group_ids     = [aws_security_group.pg.id]
  storage_encrypted          = true
  backup_retention_period    = var.env == "dev" ? 0 : 7
  skip_final_snapshot        = var.env == "dev"
  deletion_protection        = var.env != "dev"
  tags                       = { Name = local.name, Project = var.project, Env = var.env }
}

resource "aws_security_group" "pg" {
  name_prefix = "${local.name}-pg"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    from_port = 5432
    to_port   = 5432
    protocol  = "tcp"
    cidr_blocks = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
  }
}
