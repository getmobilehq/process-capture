terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State holds the Cloud SQL password, the retention token and the session
  # secret, so it belongs in a bucket rather than on a laptop.
  #
  # Deliberately EMPTY: a backend block cannot use variables, so hard-coding the
  # bucket welds this configuration to one project. The bucket is supplied at init
  # time instead, which is what lets the same code stand up a second environment:
  #
  #   tofu init -backend-config=envs/<name>.backend.hcl
  #   tofu apply -var-file=envs/<name>.tfvars
  #
  # See envs/example.backend.hcl. Create the bucket once, by hand, in the project
  # it belongs to — with versioning and uniform bucket-level access.
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}
