# Everything else depends on these being on. `disable_on_destroy = false` so a
# `terraform destroy` of Magpie does not switch off APIs another workload in the
# project may be using.
#
# `manage_apis = false` empties this set for the organisation where a platform
# team owns service enablement and the deploying identity holds no serviceusage
# rights. Nothing else changes: the depends_on references still resolve, to
# nothing, and a missing API surfaces as the API's own error at the resource that
# needs it — which names the problem better than a permission denial here would.
resource "google_project_service" "required" {
  for_each = toset(var.manage_apis ? [
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudscheduler.googleapis.com",
    "servicenetworking.googleapis.com",
    "compute.googleapis.com",
    "vpcaccess.googleapis.com",
    "aiplatform.googleapis.com",
    "monitoring.googleapis.com",
  ] : [])

  service            = each.value
  disable_on_destroy = false
}
