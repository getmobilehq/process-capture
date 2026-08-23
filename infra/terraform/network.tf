# Private Services Access: the peering that lets Cloud SQL hold a private address
# only. Most organisations enforce constraints/sql.restrictPublicIp, and that
# policy is correct for interview data — this is how you satisfy it rather than
# ask for an exception.
#
# NO depends_on on the data sources, deliberately. A data source carrying
# depends_on is deferred to apply time whenever that dependency has any pending
# change — so merely adding a service to the enabled list marked this network
# "known after apply", which forces replacement of the reserved range, the
# peering, and, because it references the network, THE DATABASE. Terraform
# planned exactly that; only deletion_protection stopped it.
#
# Read at plan time instead, giving a concrete value and a stable plan. The cost
# is that on a brand-new project where compute is not yet enabled this read fails
# — with a clear error, on a project with nothing in it, which is a far better
# failure than silently proposing to destroy a live database.

locals {
  # The network usually lives in this project. On a Shared VPC it does not, and
  # every lookup has to say so explicitly or it silently searches the wrong place.
  network_project = var.network_project_id != "" ? var.network_project_id : var.project_id
}

data "google_compute_network" "selected" {
  name    = var.network
  project = local.network_project
}

# Direct VPC egress attaches to a subnetwork, not a network. On the default VPC
# this is the auto-mode subnet for the region; on a Shared VPC it is whichever
# subnet the platform team has allocated to this workload.
data "google_compute_subnetwork" "selected" {
  name    = var.subnetwork
  region  = var.region
  project = local.network_project
}

resource "google_compute_global_address" "private_ip" {
  count         = var.manage_private_services_access ? 1 : 0
  name          = "${var.name}-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = data.google_compute_network.selected.id
  # No prevent_destroy here on purpose: it would also fire when this resource is
  # legitimately dropped to count = 0 on a move to a Shared VPC, turning a planned
  # migration into an error you have to edit the code to get past. The database is
  # the thing worth guarding, and it guards itself.
}

resource "google_service_networking_connection" "private_vpc" {
  count                   = var.manage_private_services_access ? 1 : 0
  network                 = data.google_compute_network.selected.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip[0].name]

  depends_on = [google_project_service.required]
}
