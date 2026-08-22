# Does anyone know when it breaks?
#
# There are startup and liveness probes, but those tell Cloud Run to restart a
# container — they tell no human anything. With interviews running twenty-five to
# forty minutes, the realistic failure is not a crash but silence: the service is
# down, an informant gives up, and nobody hears about it until someone asks how the
# pilot went.
#
# Two alerts, both cheap. One says the service stopped answering; one says the
# spend moved. Deliberately not a monitoring stack — this is the smallest thing
# that turns a silent failure into a message.

variable "alert_email" {
  description = <<-EOT
    Where uptime and budget alerts go. Leave empty and no alerting is created —
    the deployment still works, it just tells nobody when it stops.
  EOT
  type        = string
  default     = ""
}

locals {
  alerting = var.alert_email != ""
}

resource "google_monitoring_notification_channel" "email" {
  count        = local.alerting ? 1 : 0
  display_name = "${var.name} alerts"
  type         = "email"
  labels       = { email_address = var.alert_email }

  depends_on = [google_project_service.required]
}

# Polls /health from several regions. That endpoint already answers 200 only when
# the app is serving, so it is the right thing to watch.
resource "google_monitoring_uptime_check_config" "health" {
  count        = local.alerting ? 1 : 0
  display_name = "${var.name} is answering"
  timeout      = "10s"
  period       = "300s"
  # Three is the minimum Google accepts — a check from one region cannot tell a
  # regional network problem from the service being down.
  selected_regions = ["EUROPE", "USA_OREGON", "ASIA_PACIFIC"]

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = replace(replace(google_cloud_run_v2_service.magpie.uri, "https://", ""), "/", "")
    }
  }
}

resource "google_monitoring_alert_policy" "down" {
  count        = local.alerting ? 1 : 0
  display_name = "${var.name} is not answering"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      Magpie stopped responding on /health.

      An interview in progress will fail on its next turn, and the informant's
      unsent answer survives a reload — so the immediate question is whether anyone
      is mid-interview, not whether data is lost.

      Check: gcloud run services logs read ${var.name} --region=${var.region} --limit=100
    EOT
  }

  conditions {
    display_name = "uptime check failing"
    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\"",
        "resource.type=\"uptime_url\"",
        "metric.label.check_id=\"${google_monitoring_uptime_check_config.health[0].uptime_check_id}\"",
      ])
      comparison = "COMPARISON_LT"
      # Two consecutive failures, not one: a single missed poll is a blip, and an
      # alert that cries wolf is an alert people stop reading.
      duration        = "600s"
      threshold_value = 1
      trigger { count = 1 }

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].id]
}
