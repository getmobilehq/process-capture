resource "google_artifact_registry_repository" "magpie" {
  location      = var.region
  repository_id = var.name
  format        = "DOCKER"
  description   = "Magpie container images."
  labels        = var.labels

  depends_on = [google_project_service.required]
}
