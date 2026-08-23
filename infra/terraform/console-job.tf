# Administrative account management, as a Cloud Run job (SDD I-3).
#
# The database has a private address only, so a laptop cannot reach it and a
# laptop should not be able to. This job runs the same image on the same VPC, so
# the only way to make a console account is from inside the deployment:
#
#   gcloud run jobs execute magpie-console-user --region=europe-west2 --wait \
#     --args="--list"
#   gcloud run jobs execute magpie-console-user --region=europe-west2 --wait \
#     --args="--add,someone@virginmediao2.co.uk,--name,Their Name"
#
# Then read the generated password out of the job log. It is printed once.
#
# A job rather than a console screen, deliberately: a page for creating the
# accounts that may approve recommendations about someone's job is a privilege
# escalation waiting to be found (DL.100).
# Its own identity, not the service's. The running service holds Vertex predict,
# the model key and the console password; this job needs one thing — the database
# URL — and anyone who can execute a job can read what that job's identity can
# reach. Sharing the service account would make "run the account tool" a route to
# every other secret in the deployment.
resource "google_service_account" "console_job" {
  account_id   = "${var.name}-console-job"
  display_name = "Magpie console account administration"
}

resource "google_secret_manager_secret_iam_member" "console_job_database_url" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.console_job.email}"
}

resource "google_cloud_run_v2_job" "console_user" {
  name     = "${var.name}-console-user"
  location = var.region
  labels   = var.labels

  template {
    template {
      service_account = google_service_account.console_job.email
      max_retries     = 0

      vpc_access {
        network_interfaces {
          network    = data.google_compute_network.selected.id
          subnetwork = data.google_compute_subnetwork.selected.id
        }
        egress = "PRIVATE_RANGES_ONLY"
      }

      containers {
        image   = var.image
        command = ["node"]
        args    = ["scripts/console-user.mjs", "--list"]

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_iam_member.console_job_database_url,
    google_secret_manager_secret_version.database_url,
  ]
}
