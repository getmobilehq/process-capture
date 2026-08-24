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

variable "retention_callers" {
  description = <<-EOT
    Extra identities allowed to trigger the retention sweep by hand, on top of the
    scheduler's own service account, which is always permitted.

    Addresses, not secrets: possessing one grants nothing without a Google-signed
    token for it. To run the sweep as yourself, add your address here and call it
    with an identity token minted for this service:

      curl -X POST "$URL/api/admin/retention?dryRun=1" \
        -H "Authorization: Bearer $(gcloud auth print-identity-token --audiences=$URL)"

    Empty is the safe default and leaves only the scheduler able to run it.
  EOT
  type        = list(string)
  default     = []
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

# ── Where it plugs into the network ─────────────────────────────────────────
# Defaults describe a project with the auto-created `default` VPC, which is what
# a fresh project has and what the proving environment uses. A corporate project
# usually has neither: `compute.skipDefaultNetworkCreation` is a common org
# policy, and the project is attached to a Shared VPC owned by a platform team.
# These exist so that difference is a tfvars file rather than a fork.

variable "network" {
  description = "VPC network name for the database peering and Cloud Run egress."
  type        = string
  default     = "default"
}

variable "subnetwork" {
  description = "Subnetwork in `region`. Direct VPC egress attaches to a subnet, not a network."
  type        = string
  default     = "default"
}

variable "network_project_id" {
  description = <<-EOT
    Project that owns the network, when it is not this one — i.e. the Shared VPC
    host project. Empty means the network lives in `project_id`.
  EOT
  type        = string
  default     = ""
}

variable "manage_private_services_access" {
  description = <<-EOT
    Create the peering that gives Cloud SQL a private address. True on a project
    you control. FALSE on a Shared VPC: private services access is configured once
    on the host project by the team that owns it, and a second attempt from here
    both fails and is the wrong place to ask.
  EOT
  type        = bool
  default     = true
}

variable "manage_apis" {
  description = <<-EOT
    Enable the required Google APIs. Set false where a platform team enables APIs
    centrally and the deploying identity has no serviceusage rights — Terraform
    then assumes they are already on and fails plainly if they are not.
  EOT
  type        = bool
  default     = true
}

# ── How it is reached ───────────────────────────────────────────────────────

variable "ingress" {
  description = <<-EOT
    Cloud Run ingress. INGRESS_TRAFFIC_ALL is required for informants to open a
    tokenised link directly. Where an organisation refuses public services, set
    INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER and put a load balancer with IAP in
    front — the app is unchanged, but the invite links must then resolve to it.
  EOT
  type        = string
  default     = "INGRESS_TRAFFIC_ALL"
}

variable "allow_public_access" {
  description = <<-EOT
    Grant roles/run.invoker to allUsers. The interview face is opened from a
    tokenised link by people with no Google account, so authorisation is the token
    and the console password, not IAM.

    Set false where `iam.allowedPolicyMemberDomains` forbids allUsers — which is
    the norm in a large organisation. The service then answers only callers the
    fronting load balancer authenticates, and that must be in place first or the
    deployment is unreachable, including by you.
  EOT
  type        = bool
  default     = true
}

variable "vertex_least_privilege" {
  description = <<-EOT
    Grant a custom role carrying only aiplatform.endpoints.predict rather than
    roles/aiplatform.user, which also permits creating datasets, training jobs and
    endpoints. Transcription only predicts.

    Set false if a policy forbids custom roles, or to fall back quickly should a
    future Vertex call need a permission the narrow role lacks.
  EOT
  type        = bool
  default     = true
}

# ── Where the interview model is called ─────────────────────────────────────

variable "model_provider" {
  description = <<-EOT
    `anthropic` calls the direct API with a key from Secret Manager. `vertex`
    calls the same Claude models through Vertex AI Model Garden in this project:
    no key to issue or rotate, the service account is the credential, the traffic
    stays inside Google's network, and the spend lands on the GCP invoice rather
    than a second vendor agreement.

    Before switching, the Anthropic models must be enabled once in Model Garden —
    that is a terms acceptance in the console, and until it is done every call
    returns 404.
  EOT
  type        = string
  default     = "anthropic"

  validation {
    condition     = contains(["anthropic", "vertex"], var.model_provider)
    error_message = "model_provider must be \"anthropic\" or \"vertex\"."
  }
}

variable "vertex_model_region" {
  description = <<-EOT
    Region serving the interview model. Deliberately separate from the
    transcription region: europe-west2 runs Gemini but serves no Anthropic model
    at all, so Claude means europe-west1 at the nearest — EU rather than UK. That
    is a data-residency decision to take deliberately, not to inherit.
  EOT
  type        = string
  default     = "europe-west1"
}
