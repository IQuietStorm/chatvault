variable "project" {
  description = "Project name (prefix for resources)"
  type        = string
  default     = "chatvault"
}

variable "env" {
  description = "Environment: dev | staging | prod"
  type        = string
  default     = "dev"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "db_username" {
  description = "RDS Postgres username"
  type        = string
  default     = "chatvault"
}

variable "db_password" {
  description = "RDS Postgres password (Terraform var or -var-file; never commit)"
  type        = string
  sensitive   = true
  default     = "CHANGE_ME_IN_PRODUCTION"
}
