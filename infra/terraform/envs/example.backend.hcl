# Terraform state location. One of these per environment.
#   tofu init -backend-config=envs/<name>.backend.hcl
#
# The bucket lives in the project it serves, and holds secrets in cleartext —
# create it with versioning on and uniform bucket-level access, and keep its IAM
# to the people who deploy.
bucket = "YOUR-PROJECT-tfstate"
prefix = "magpie"
