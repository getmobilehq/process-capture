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

# The retention token is Terraform's because the scheduler job must send it; a
# value only one side knows is no use to the other.
resource "google_secret_manager_secret" "retention_token" {
  secret_id = "${var.name}-retention-token"
  labels    = var.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "retention_token" {
  secret      = google_secret_manager_secret.retention_token.id
  secret_data = var.retention_token
}

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
