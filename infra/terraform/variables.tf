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
    Cloud Run maximum instances.

    This was pinned to 1 as a correctness constraint while rate limiting lived in
    process memory — a second instance silently doubled every limit. Rate limiting
    now shares its buckets in Postgres (SDD I-1, resolved), so this is once again
    an ordinary capacity choice.

    Two things still scale per instance rather than globally: the database
    connection pool (DB_POOL_MAX, 5 by default) and boot-time migrations, which
    are safe because Drizzle takes a lock but will serialise a cold start.
  EOT
  type        = number
  default     = 3
}

variable "transcribe_provider" {
  description = <<-EOT
    Voice-to-text provider: "gemini" (Vertex AI, in this project) or "whisper"
    (OpenAI). Gemini is what company policy asks for; Whisper stays available
    until Gemini has proven itself.
  EOT
  type        = string
  default     = "gemini"

  validation {
    condition     = contains(["gemini", "whisper"], var.transcribe_provider)
    error_message = "transcribe_provider must be gemini or whisper."
  }
}

variable "transcribe_fallback" {
  description = <<-EOT
    Allow a transient failure of the chosen provider to be answered by the other
    one. OFF by default: a policy that says "use Gemini" is not satisfied by a
    system that quietly uses OpenAI whenever Gemini has a bad minute. Turning this
    on sends audio to the other vendor on those occasions — a deliberate choice.
  EOT
  type        = bool
  default     = false
}

variable "gemini_transcribe_model" {
  description = "Vertex model used for transcription."
  type        = string
  default     = "gemini-2.5-flash"
}

variable "enable_tobe" {
  description = <<-EOT
    Expose the analysis views: to-be map, opportunity overlay and automation
    assessment. Everything they produce is marked proposed and unverified, and
    cannot reach a handover report until a person has ruled on each item (R5.4),
    so this is safe to enable — but a reader still meets claims about how work
    could change, which is a deliberate choice rather than a default.
  EOT
  type        = bool
  default     = false
}

variable "labels" {
  description = "Labels applied to every resource that accepts them."
  type        = map(string)
  default     = { app = "magpie", managed-by = "terraform" }
}
