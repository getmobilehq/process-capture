# One of these per environment. Copy, rename, edit.
#   tofu apply -var-file=envs/<name>.tfvars
#
# Secrets are never here — pass them as environment variables:
#   export TF_VAR_db_password="$(openssl rand -base64 24)"
#   export TF_VAR_retention_token="$(openssl rand -hex 32)"

project_id = "your-gcp-project"
region     = "europe-west2"
image      = "europe-west2-docker.pkg.dev/your-gcp-project/magpie/magpie:TAG"

# Analysis views: to-be map, opportunity overlay, automation assessment.
enable_tobe = true

# Voice to text through Vertex AI in this same project.
transcribe_provider = "gemini"
transcribe_fallback = false

# See the note in variables.tf before changing these.
# max_instances  = 3
# retention_days = 365

# Uptime and budget alerts. Leave empty and nothing is created — the deployment
# works, it simply tells nobody when it stops answering.
alert_email = ""
