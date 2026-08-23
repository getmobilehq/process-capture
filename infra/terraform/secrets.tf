# Secret containers are managed here; their *values* mostly are not.
#
# Terraform state records every value it manages, so putting the model key and
# console password in a tfvars file would spread them across state, plan output
# and a file on someone's laptop. Those two are set once with gcloud (see README)
# and Terraform only ever references :latest.
#
# database-url is the exception. Its value is derived from the instance's private
# address, which only Terraform knows, and it contains a password Terraform must
# already hold to manage the SQL user — so writing it here reveals nothing state
# does not already contain.
locals {
  secrets = {
    anthropic-api-key = "Model API key."
    admin-password    = "Console password."
  }
}

resource "google_secret_manager_secret" "external" {
  for_each  = local.secrets
  secret_id = "${var.name}-${each.key}"
  labels    = var.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

# Signs console session cookies. Terraform generates it rather than asking for it:
# nobody needs to know this value, and one fewer secret a person handles is one
# fewer secret a person mishandles. Rotating it signs everyone out, which is the
# correct behaviour and the reason it is separate from any password.
resource "random_password" "session_secret" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "session_secret" {
  secret_id = "${var.name}-session-secret"
  labels    = var.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "session_secret" {
  secret      = google_secret_manager_secret.session_secret.id
  secret_data = random_password.session_secret.result
}

# There is no retention-token secret any more. The sweep authenticates the
# caller's identity from its OIDC token instead, which removes a shared value that
# had to sit in clear text in the scheduler job's configuration for anyone with
# cloudscheduler.jobs.get to read (DL.146).

resource "google_secret_manager_secret" "database_url" {
  secret_id = "${var.name}-database-url"
  labels    = var.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret = google_secret_manager_secret.database_url.id
  secret_data = format(
    "postgres://%s:%s@%s:5432/%s",
    google_sql_user.magpie.name,
    var.db_password,
    google_sql_database_instance.magpie.private_ip_address,
    google_sql_database.magpie.name,
  )
}
