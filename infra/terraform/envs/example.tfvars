# One of these per environment. Copy, rename, edit.
#   tofu apply -var-file=envs/<name>.tfvars
#
# Secrets are never here — pass them as environment variables:
#   export TF_VAR_db_password="$(openssl rand -base64 24)"

project_id = "your-gcp-project"
region     = "europe-west2"
image      = "europe-west2-docker.pkg.dev/your-gcp-project/magpie/magpie:TAG"

# Analysis views: to-be map, opportunity overlay, automation assessment.
enable_tobe = true

# Voice to text through Vertex AI in this same project.
transcribe_provider = "gemini"
transcribe_fallback = false

# Where the interview model is called. "anthropic" is the direct API with a key;
# "vertex" is the same Claude models through Model Garden in this project — no
# key, the service account is the credential, spend on the GCP invoice.
#
# Before switching: enable the Anthropic models once in Vertex AI Model Garden
# (a terms acceptance in the console) or every call returns 404. And note the
# region — europe-west2 serves no Anthropic model, so Claude means EU, not UK.
# model_provider      = "vertex"
# vertex_model_region = "europe-west1"
# model               = "claude-sonnet-4-5@20250929"   # Vertex names the version

# See the note in variables.tf before changing these.
# max_instances  = 3
# retention_days = 365

# Uptime and budget alerts. Leave empty and nothing is created — the deployment
# works, it simply tells nobody when it stops answering.
alert_email = ""

# Anyone here may also trigger the retention sweep by hand, on top of the
# scheduler. Addresses, not secrets — a Google-signed token is still required.
# retention_callers = ["you@example.com"]

# ── Deploying into an organisation's project ────────────────────────────────
# Defaults assume the auto-created `default` VPC and a project that permits
# public services. Where that is not true, see README §"Deploying into an
# organisation's project" — these are the switches, none of which changes the app.
# network                        = "shared-vpc-prod"
# subnetwork                     = "magpie-euw2"
# network_project_id             = "host-project-id"
# manage_private_services_access = false
# manage_apis                    = false
# allow_public_access            = false
# ingress                        = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
