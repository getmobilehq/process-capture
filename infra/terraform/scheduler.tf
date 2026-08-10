# The nightly retention sweep (SDD issue I-2). Without this, RETENTION_DAYS is a
# number nothing acts on and interview content is kept forever.
#
# The endpoint returns 404 unless RETENTION_TOKEN is set on the service, so this
# job is inert until the secret has a version. That is the intended order: create
# the infrastructure, run the sweep by hand in report mode, then let it run.
resource "google_cloud_scheduler_job" "retention" {
  name        = "${var.name}-retention"
  region      = var.region
  description = "Delete interview content past the retention window."
  schedule    = var.retention_schedule
  time_zone   = "Europe/London"

  # A sweep that fails is retried; a sweep that runs twice deletes nothing extra,
  # because the second pass finds nothing left to expire.
  retry_config {
    retry_count = 3
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.magpie.uri}/api/admin/retention"

    headers = {
      "Content-Type" = "application/json"
      # NOT Authorization — the OIDC token below occupies that header. OIDC says
      # "this really is the scheduler"; the token says "and it is allowed to do
      # this". Either alone would do less.
      "X-Retention-Token" = var.retention_token
    }

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.magpie.uri
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_service_account" "scheduler" {
  account_id   = "${var.name}-scheduler"
  display_name = "Magpie retention scheduler"
}

resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker" {
  name     = google_cloud_run_v2_service.magpie.name
  location = google_cloud_run_v2_service.magpie.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}
