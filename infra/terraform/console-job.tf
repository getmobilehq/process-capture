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
resource "google_cloud_run_v2_job" "console_user" {
  name     = "${var.name}-console-user"
  location = var.region
  labels   = var.labels

  template {
    template {
      service_account = google_service_account.magpie.email
      max_retries     = 0

      vpc_access {
        network_interfaces {
          network    = data.google_compute_network.default.id
          subnetwork = data.google_compute_subnetwork.default.id
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
    google_secret_manager_secret_iam_member.database_url,
    google_secret_manager_secret_version.database_url,
  ]
}
