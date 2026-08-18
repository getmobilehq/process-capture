# Cloud SQL for PostgreSQL 16.
#
# edition = ENTERPRISE is deliberate: the API now defaults to Enterprise Plus,
# which rejects small tiers with "Invalid Tier". The smallest Plus machine is
# many times the cost, so the fix is the edition, not the tier.
resource "google_sql_database_instance" "magpie" {
  name             = "${var.name}-db"
  database_version = "POSTGRES_16"
  region           = var.region
  # A pilot database is not something to lose to a stray destroy.
  deletion_protection = true

  settings {
    # The provider-side flag above stops Terraform destroying this. This one stops
    # everyone else — gcloud, the console, any API caller. "Terraform won't" and
    # "nobody can" are different guarantees and a pilot wants both.
    deletion_protection_enabled = true

    tier      = var.db_tier
    edition   = "ENTERPRISE"
    disk_size = 10
    disk_type = "PD_SSD"
    # Interview content grows slowly; let it, rather than page someone at 2am.
    disk_autoresize = true
    user_labels     = var.labels

    ip_configuration {
      # No public address at all. Cloud Run reaches it over the peering above.
      ipv4_enabled                                  = false
      private_network                               = data.google_compute_network.default.id
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "02:00"
      point_in_time_recovery_enabled = true
      backup_retention_settings {
        # Thirty, not seven: a misconfigured retention sweep discovered a fortnight
        # later must still be recoverable. Pennies at this data size.
        retained_backups = 30
      }
    }

    maintenance_window {
      day          = 7 # Sunday
      hour         = 3
      update_track = "stable"
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }
  }

  depends_on = [google_service_networking_connection.private_vpc]
}

resource "google_sql_database" "magpie" {
  name     = var.name
  instance = google_sql_database_instance.magpie.name
}

resource "google_sql_user" "magpie" {
  name     = var.name
  instance = google_sql_database_instance.magpie.name
  password = var.db_password
}
