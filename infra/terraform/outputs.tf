output "service_url" {
  description = "Where Magpie is. The console is at /console."
  value       = google_cloud_run_v2_service.magpie.uri
}

output "image_repository" {
  description = "Push built images here."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.magpie.repository_id}"
}

output "database_private_ip" {
  description = "Cloud SQL private address. There is no public one."
  value       = google_sql_database_instance.magpie.private_ip_address
}

output "service_account" {
  description = "The identity Magpie runs as."
  value       = google_service_account.magpie.email
}

output "secrets_to_populate" {
  description = "Secrets Terraform creates but does not fill. Set these before the first deploy."
  value       = [for s in google_secret_manager_secret.external : s.secret_id]
}
