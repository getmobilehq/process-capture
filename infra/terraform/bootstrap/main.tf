# The bucket that holds Terraform state — the one thing that cannot be created by
# the configuration it stores the state for.
#
# It was made by hand here, which is the ordinary way and the wrong one: state
# contains the database password and the session secret, and "I think I remembered
# to turn versioning on" is not a property anyone can audit. A hand-made bucket
# also cannot be recreated identically at VMO2, where the person doing it will not
# be the person who made this one.
#
# Separate root module with LOCAL state, deliberately. A bucket cannot hold the
# state describing itself before it exists, and the chicken-and-egg is not worth
# solving: this runs once, changes almost never, and the local state file it
# produces records nothing secret — a bucket name and its settings.
#
#   cd infra/terraform/bootstrap
#   tofu init
#   tofu apply -var project_id=<project> -var name=<magpie>
#
# Then use the bucket it prints in envs/<env>.backend.hcl.

terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

variable "project_id" {
  description = "Project that will own the state bucket."
  type        = string
}

variable "name" {
  description = "Base name, matching the main configuration."
  type        = string
  default     = "magpie"
}

variable "location" {
  description = "Bucket location. Keep state in the same jurisdiction as the data."
  type        = string
  default     = "europe-west2"
}

provider "google" {
  project = var.project_id
}

resource "google_storage_bucket" "state" {
  name     = "${var.project_id}-tfstate"
  location = var.location

  # Every prior version kept. State is the only record of what exists; a corrupt
  # or truncated write with no history is a rebuild from nothing.
  versioning {
    enabled = true
  }

  # ACLs off. With uniform access the bucket's IAM is the whole story, rather than
  # IAM plus a per-object legacy system nobody reads.
  uniform_bucket_level_access = true

  # State holds the database password. It should not be one misclick from public,
  # and this makes the misclick impossible rather than unlikely.
  public_access_prevention = "enforced"

  # Old versions are not kept forever — a decade of state is not diligence, it is
  # a decade of copies of a password nobody rotated.
  lifecycle_rule {
    condition {
      num_newer_versions = 20
    }
    action {
      type = "Delete"
    }
  }

  # Deleting this loses the map to everything Terraform manages. The resources
  # would survive; the ability to change them safely would not.
  lifecycle {
    prevent_destroy = true
  }

  labels = { app = var.name, managed-by = "terraform", contains = "state" }
}

output "backend_config" {
  description = "Paste into envs/<env>.backend.hcl."
  value       = <<-EOT
    bucket = "${google_storage_bucket.state.name}"
    prefix = "${var.name}"
  EOT
}
