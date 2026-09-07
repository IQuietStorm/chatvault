output "media_bucket" {
  description = "S3 media bucket name"
  value       = aws_s3_bucket.media.id
}

output "cloudfront_domain" {
  description = "CloudFront CDN hostname for presigned media URLs"
  value       = aws_cloudfront_distribution.media.domain_name
}

output "redis_endpoint" {
  description = "ElastiCache Redis primary endpoint"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "postgres_endpoint" {
  description = "RDS PostgreSQL writer endpoint"
  value       = aws_db_instance.pg.address
}
