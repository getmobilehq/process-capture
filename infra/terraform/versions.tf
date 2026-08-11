terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # State holds the Cloud SQL password (Terraform must know it to manage the SQL
  # user), so it is sensitive. Keep it in a bucket, not on a laptop. Create the
  # bucket once, by hand, then uncomment:
  #
  #   gcloud storage buckets create gs://YOUR-PROJECT-tfstate \
  #     --location=europe-west2 --uniform-bucket-level-access
  #   gcloud storage buckets update gs://YOUR-PROJECT-tfstate --versioning
  #
  backend "gcs" {
    bucket = "magpie-505120-tfstate"
    prefix = "magpie"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
