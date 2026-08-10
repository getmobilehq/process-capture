# Private Services Access: the peering that lets Cloud SQL hold a private address
# only. Most organisations enforce constraints/sql.restrictPublicIp, and that
# policy is correct for interview data — this is how you satisfy it rather than
# ask for an exception.
data "google_compute_network" "default" {
  name       = "default"
  depends_on = [google_project_service.required]
}

resource "google_compute_global_address" "private_ip" {
  name          = "${var.name}-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = data.google_compute_network.default.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = data.google_compute_network.default.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip.name]

  depends_on = [google_project_service.required]
}

# Direct VPC egress attaches to a subnetwork, not a network. The default VPC has
# one auto-mode subnet per region and this is it.
data "google_compute_subnetwork" "default" {
  name       = "default"
  region     = var.region
  depends_on = [google_project_service.required]
}
