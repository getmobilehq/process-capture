# A dedicated identity, so Magpie's access to secrets is its own and auditable
# rather than the project's default compute account with editor on everything.
resource "google_service_account" "magpie" {
  account_id   = "${var.name}-run"
  display_name = "Magpie Cloud Run service"
}

resource "google_secret_manager_secret_iam_member" "external" {
  for_each  = google_secret_manager_secret.external
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.magpie.email}"
}

resource "google_secret_manager_secret_iam_member" "retention_token" {
  secret_id = google_secret_manager_secret.retention_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.magpie.email}"
}

resource "google_secret_manager_secret_iam_member" "database_url" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.magpie.email}"
}

# Voice-to-text through Vertex AI runs as this service, not as a key holder —
# which is the point: nothing to issue, rotate or govern, and the audio never
# leaves the project.
resource "google_project_iam_member" "vertex_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.magpie.email}"
}

resource "google_cloud_run_v2_service" "magpie" {
  name     = var.name
  location = var.region
  labels   = var.labels
  # The service holds no state — the database does, and that keeps its own
  # protection. Guarding the service only blocks the recreate you need when a
  # revision is wedged, which is the one time you are most in a hurry.
  deletion_protection = false
  # Google's front end terminates TLS and forwards; the app is not exposed directly.
  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.magpie.email
    # Migrations run at boot and the container refuses to start if they fail, so
    # give a cold start room before Cloud Run gives up on it.
    timeout = "600s"

    scaling {
      # One instance minimum keeps the first interview of the day off a cold
      # start. The maximum is now a capacity choice rather than a correctness
      # one: rate limits are shared in Postgres, so N instances enforce the same
      # limit N=1 did.
      min_instance_count = 1
      max_instance_count = var.max_instances
    }

    vpc_access {
      network_interfaces {
        network    = data.google_compute_network.default.id
        subnetwork = data.google_compute_subnetwork.default.id
      }
      # Only private ranges go over the VPC; the model API still egresses normally.
      egress = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      ports {
        container_port = 3000
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "MODEL"
        value = var.model
      }
      env {
        name  = "TRANSCRIBE_PROVIDER"
        value = var.transcribe_provider
      }
      env {
        name  = "TRANSCRIBE_FALLBACK"
        value = var.transcribe_fallback ? "1" : "0"
      }
      env {
        name  = "VERTEX_PROJECT"
        value = var.project_id
      }
      env {
        name  = "VERTEX_REGION"
        value = var.region
      }
      env {
        name  = "GEMINI_TRANSCRIBE_MODEL"
        value = var.gemini_transcribe_model
      }

      env {
        name  = "RETENTION_DAYS"
        value = tostring(var.retention_days)
      }
      env {
        name = "ENABLE_TOBE"
        # Analysis views are proposals until a human has reviewed them; a pilot
        # audience should not meet them unlabelled.
        value = var.enable_tobe ? "1" : "0"
      }

      # BASE_URL is deliberately unset. The app derives its origin from the
      # request when it is absent (lib/origin.ts), which is what lets this be a
      # single apply instead of deploy-read-the-URL-redeploy. Set it only when a
      # custom domain is in front.

      dynamic "env" {
        for_each = google_secret_manager_secret.external
        content {
          # magpie-anthropic-api-key -> ANTHROPIC_API_KEY
          name = upper(replace(env.key, "-", "_"))
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }

      env {
        name = "RETENTION_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.retention_token.secret_id
            version = "latest"
          }
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

      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 10
        period_seconds        = 5
        failure_threshold     = 30
      }

      liveness_probe {
        http_get {
          path = "/health"
        }
        period_seconds = 30
      }
    }
  }

  depends_on = [
    google_project_iam_member.vertex_user,
    google_secret_manager_secret_iam_member.external,
    google_secret_manager_secret_iam_member.database_url,
    google_secret_manager_secret_iam_member.retention_token,
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.retention_token,
  ]
}

# The interview face is opened by informants from a tokenised link, so the
# service itself is public. Authorisation is the token and the console password,
# not IAM.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.magpie.name
  location = google_cloud_run_v2_service.magpie.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
