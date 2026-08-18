# Private Services Access: the peering that lets Cloud SQL hold a private address
# only. Most organisations enforce constraints/sql.restrictPublicIp, and that
# policy is correct for interview data — this is how you satisfy it rather than
# ask for an exception.
# NO depends_on, deliberately. A data source carrying depends_on is deferred to
# apply time whenever that dependency has any pending change — so merely adding a
# service to the list above marked this network "known after apply", which forces
# replacement of the reserved range, the peering, and, because it references the
# network, THE DATABASE. Terraform planned exactly that; only deletion_protection
# stopped it.
#
# Read at plan time instead, giving a concrete value and a stable plan. The cost
# is that on a brand-new project where compute is not yet enabled this read fails
# — with a clear error, on a project with nothing in it, which is a far better
# failure than silently proposing to destroy a live database.
data "google_compute_network" "default" {
  name = "default"
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
  name   = "default"
  region = var.region
}
