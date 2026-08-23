# Address changes, declared so Terraform moves state rather than replaces
# infrastructure.
#
# Putting `count` on an existing resource renames it in state:
# `foo.bar` becomes `foo.bar[0]`. Terraform does not infer that — it sees one
# address gone and another arrived, and plans a destroy and a create. For the
# peering range and the service networking connection that is not a cosmetic
# difference: recreating them takes the database's private address with them, and
# this configuration has already once produced a plan that would have destroyed
# the database (see network.tf).
#
# These blocks are the whole safety of that change. They can be deleted once every
# environment has applied past them, but there is no cost to leaving them.

moved {
  from = google_compute_global_address.private_ip
  to   = google_compute_global_address.private_ip[0]
}

moved {
  from = google_service_networking_connection.private_vpc
  to   = google_service_networking_connection.private_vpc[0]
}

moved {
  from = google_cloud_run_v2_service_iam_member.public
  to   = google_cloud_run_v2_service_iam_member.public[0]
}
