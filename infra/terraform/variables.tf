variable "project_id" {
  description = "The GCP project Magpie is deployed into."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Cloud SQL, Artifact Registry and the scheduler."
  type        = string
  default     = "europe-west2"
}

variable "name" {
  description = "Base name for every resource. Change it to run a second environment alongside."
  type        = string
  default     = "magpie"
}

variable "image" {
  description = <<-EOT
    Full image reference for Cloud Run, e.g.
    europe-west2-docker.pkg.dev/PROJECT/magpie/magpie:2026-08-10.

    Terraform does not build the image. Build and push first (see README), then
    apply — infrastructure and application releases move at different rates and
    coupling them makes both harder to reason about.
  EOT
  type        = string
}

variable "db_password" {
  description = <<-EOT
    Password for the Cloud SQL user. Supply it out of band:
      export TF_VAR_db_password="$(openssl rand -base64 24)"

    Terraform must know this to manage the SQL user, so it lands in state. That is
    why the GCS backend in versions.tf is not optional for real use.
  EOT
  type        = string
  sensitive   = true
}

variable "retention_token" {
  description = <<-EOT
    Shared token the retention sweep must present. Supply it out of band:
      export TF_VAR_retention_token="$(openssl rand -hex 32)"

    Terraform holds this because the scheduler job has to send it, so it is in
    state alongside db_password — see the backend note in versions.tf.
  EOT
  type        = string
  sensitive   = true
}

variable "db_tier" {
  description = "Cloud SQL machine type. db-g1-small is the pilot size."
  type        = string
  default     = "db-g1-small"
}

variable "model" {
  description = "Model identifier (P5 — models are configuration)."
  type        = string
  default     = "claude-sonnet-4-6"
}

variable "retention_days" {
  description = "How long interview content is kept before the nightly sweep removes it."
  type        = number
  default     = 365

  validation {
    condition     = var.retention_days > 0
    error_message = "retention_days must be a positive number of days."
  }
}

variable "retention_schedule" {
  description = "Cron for the retention sweep, in Europe/London."
  type        = string
  default     = "30 2 * * *"
}

variable "max_instances" {
  description = <<-EOT
    Cloud Run maximum instances. Pinned to 1 for the pilot and that is a
    CORRECTNESS constraint, not a capacity choice: rate limiting is currently
    in-process (SDD issue I-1), so a second instance doubles the effective limit.
    Do not raise this until rate limiting moves to shared state.
  EOT
  type        = number
  default     = 1
}

variable "enable_tobe" {
  description = "Expose the to-be map and opportunity overlay. Off for a pilot audience."
  type        = bool
  default     = false
}

variable "labels" {
  description = "Labels applied to every resource that accepts them."
  type        = map(string)
  default     = { app = "magpie", managed-by = "terraform" }
}
