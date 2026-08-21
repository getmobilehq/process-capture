# Deploying Magpie to Google Cloud with Terraform

A complete, ordered runbook. Roughly **80 minutes** end to end, most of it waiting.

Everything lives in `infra/terraform`. `DEPLOY-GCP.md` describes the same deployment as individual `gcloud` commands — useful for understanding what Terraform does on your behalf, but this is the path to use.

## At a glance

| Step | What | Time |
|---|---|---|
| Step 0 | What you need before you start | 5 min |
| Step 1 | Install the tools | 10 min |
| Step 2 | Sign in — twice | 5 min |
| Step 3 | Create the state bucket | 5 min |
| Step 4 | Configure the deployment | 5 min |
| Step 5 | Create the image registry first | 5 min |
| Step 6 | Build and push the container | 10 min |
| Step 7 | Build everything else | 20 min |
| Step 8 | Set the two secrets Terraform does not hold | 5 min |
| Step 9 | Check it is alive | 5 min |
| Step 10 | Prove the retention sweep, then let it run | 10 min |

## Step 0 · What you need before you start

Gather these three things first. Every later step assumes them, and finding out at step 6 that you lack a permission is an expensive way to learn it.

- **A GCP project with billing enabled.** Note its project ID — not its display name. `gcloud projects list` shows both.
- **Permissions on that project.** `roles/owner` is simplest. If your organisation does not grant it, you need: Service Usage Admin, Cloud SQL Admin, Cloud Run Admin, Secret Manager Admin, Artifact Registry Admin, Compute Network Admin, Service Account Admin, Cloud Scheduler Admin, and Storage Admin.
- **An Anthropic API key**, and a console password you have chosen. You will set both in Step 8; they are never written into Terraform.

> **Note.** If your organisation enforces `constraints/sql.restrictPublicIp`, that is fine — this deployment gives the database a private address only, which is what that policy is asking for. You do not need an exception.

## Step 1 · Install the tools

Three tools. On macOS with Homebrew:

```bash
brew install --cask google-cloud-sdk
brew install opentofu
# Docker Desktop, if you do not already have it:
brew install --cask docker
```

This runbook uses **OpenTofu** (`tofu`), the open-source Terraform. If your organisation standardises on HashiCorp Terraform, install that instead and read every `tofu` below as `terraform` — the configuration is identical and works with both.

*Check it worked:*
```bash
tofu version && gcloud version && docker version
```

## Step 2 · Sign in — twice

This trips people up, so it is its own step. You must authenticate **twice**, for two different things:

```bash
# 1 · For the gcloud CLI itself
gcloud auth login

# 2 · For Terraform, which uses Application Default Credentials
gcloud auth application-default login
```

> **Note.** Skipping the second command is the single most common failure here. Terraform does not use your `gcloud` session — it looks for Application Default Credentials, and without them the first `tofu plan` fails with a confusing credentials error.

```bash
export PROJECT=your-project-id
export REGION=europe-west2
gcloud config set project $PROJECT
```

*Check it worked:*
```bash
gcloud config get-value project
```

## Step 3 · Create the state bucket

Terraform records what it built in a state file. That file will contain the database password and the retention token — Terraform must know both to manage the SQL user and the scheduler job — so it belongs in a private bucket, not on a laptop.

```bash
gcloud storage buckets create gs://$PROJECT-tfstate \
  --location=$REGION --uniform-bucket-level-access
gcloud storage buckets update gs://$PROJECT-tfstate --versioning
```

Then open `infra/terraform/versions.tf`, uncomment the `backend "gcs"` block, and set the bucket name:

```bash
backend "gcs" {
  bucket = "YOUR-PROJECT-tfstate"
  prefix = "magpie"
}
```

> **Note.** Versioning is on deliberately. State is the record of what exists; if it is lost or corrupted, Terraform no longer knows what it manages and reconciling by hand is painful.

## Step 4 · Configure the deployment

Copy the example variables and edit them. The two secrets stay out of the file — they are passed as environment variables so they never land in the working tree.

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: set project_id and region
```

```bash
export TF_VAR_db_password="$(openssl rand -base64 24)"
export TF_VAR_retention_token="$(openssl rand -hex 32)"
```

> **Note.** Save those two values somewhere durable — a password manager, not a terminal buffer. Losing them is not fatal, but recovering means a fresh `apply` to rotate them, and the retention token is needed again in Step 10.

Leave `image` as it is for now. It is set in Step 6, once there is an image to point at.

## Step 5 · Create the image registry first

Chicken and egg: Cloud Run needs an image, and the image needs somewhere to be pushed. So create just the registry, ahead of everything else.

```bash
tofu init
tofu apply -target=google_artifact_registry_repository.magpie
```

Terraform will also enable the required Google APIs, because the registry depends on them. Review the plan and type `yes`.

*Check it worked:*
```bash
tofu output -raw image_repository
```

## Step 6 · Build and push the container

Terraform does not build the image. Infrastructure and application releases move at different rates, and coupling them makes both harder to reason about.

```bash
REPO=$(tofu output -raw image_repository)
TAG=$REPO/magpie:$(date +%Y-%m-%d)

gcloud auth configure-docker ${REGION}-docker.pkg.dev
docker build --platform linux/amd64 -t $TAG ../..
docker push $TAG

echo $TAG   # paste this into terraform.tfvars as `image`
```

> **Note.** `--platform linux/amd64` is not optional on an Apple Silicon Mac. Cloud Run cannot run an arm64 image, and the failure it gives you does not say so — the container simply never becomes ready.

Now set `image = "<the tag you just echoed>"` in `terraform.tfvars`.

## Step 7 · Build everything else

One apply creates the rest: private networking, the Cloud SQL instance, Secret Manager entries, the Cloud Run service with its own identity, and the nightly retention job.

```bash
tofu apply
```

Read the plan before you accept it. It should create roughly twenty resources and destroy none. Then type `yes`.

> **Note.** Expect about fifteen minutes, nearly all of it waiting for Cloud SQL. This is normal and there is nothing to do but wait. If it fails part way, run `tofu apply` again — it picks up where it stopped rather than starting over.

*Check it worked:*
```bash
tofu output
```

## Step 8 · Set the two secrets Terraform does not hold

The model API key and the console password are deliberately never in Terraform state. Set their values directly, then force a new revision so the service picks them up.

```bash
printf 'sk-ant-your-key-here' | \
  gcloud secrets versions add magpie-anthropic-api-key --data-file=-

printf 'your-console-password' | \
  gcloud secrets versions add magpie-admin-password --data-file=-

gcloud run services update magpie --region=$REGION \
  --update-labels=secrets-set=$(date +%s)
```

> **Note.** Use `printf`, not `echo`. `echo` appends a newline, and the newline becomes part of the secret — which produces a console password that silently never works and an API key rejected as malformed.

## Step 9 · Check it is alive

Two checks: the health endpoint, and a real sign-in.

```bash
URL=$(tofu output -raw service_url)
curl -s $URL/health
# {"status":"ok","service":"process-capture"}

open $URL/console
```

Sign in with the password you set in Step 8, create a campaign, add an interviewee, and copy their link. The link will carry the Cloud Run hostname automatically — the application takes its origin from the request, so there is no second deployment to configure a base URL.

*Check it worked:*
```bash
curl -s -o /dev/null -w '%{http_code}\n' $URL/health
```

## Step 10 · Prove the retention sweep, then let it run

Interview content is a named person's account of their own job, held with their work email address. The retention sweep is what stops it being kept forever. Terraform has already scheduled it for 02:30 nightly — but run it once by hand, in report mode, before you trust it.

```bash
curl -s -X POST \
  -H "X-Retention-Token: $TF_VAR_retention_token" \
  "$URL/api/admin/retention?dryRun=1"
```

`dryRun=1` reports what would be deleted and deletes nothing. On a fresh deployment it should report zero of everything. Drop the parameter to carry a sweep out for real.

> **Note.** What it removes: a session expires `RETENTION_DAYS` (365 by default) after it finished — or after it was last touched, if it never finished — and everything beneath it goes too, including the specification. An interviewee record goes once they hold no sessions, and that is what removes the email address. Campaigns are never touched.

## Afterwards — the things you will actually do

### Releasing a new version

Build, push, update the tag, apply. Terraform replaces the Cloud Run revision and leaves the database alone.

```bash
TAG=$(tofu output -raw image_repository)/magpie:$(date +%Y-%m-%d)
docker build --platform linux/amd64 -t $TAG ../..
docker push $TAG
# set image = "$TAG" in terraform.tfvars
tofu apply
```

### Rotating the console password

Add a new secret version and force a revision. No Terraform involved.

```bash
printf 'the-new-password' | \
  gcloud secrets versions add magpie-admin-password --data-file=-
gcloud run services update magpie --region=$REGION \
  --update-labels=rotated=$(date +%s)
```

### Rotating the database password or retention token

These are Terraform's, so change the variable and apply.

```bash
export TF_VAR_db_password="$(openssl rand -base64 24)"
tofu apply
```

### Reading the logs

Cloud Run's logs, newest last.

```bash
gcloud run services logs read magpie --region=$REGION --limit=100
```

### Tearing it down

Deliberately two steps, so it cannot happen by accident. Set `deletion_protection = false` on the database in `database.tf`, apply that, then destroy.

```bash
tofu apply    # with deletion_protection = false
tofu destroy
```

## Moving to a different GCP project

Everything here is parameterised by `project_id`, so a second environment is a
second variables file rather than a second copy of the code:

```bash
tofu init -backend-config=envs/vmo2.backend.hcl -reconfigure
tofu apply -var-file=envs/vmo2.tfvars
```

`MIGRATE-TO-NEW-PROJECT.md` is the full runbook, including the one thing that can
stop you — the organisation policy that permits public Cloud Run.

## Creating console accounts

Reviews are attributed to whoever is signed in, so give each architect an account
before they start reviewing — attribution cannot be applied retrospectively.

The password is generated on **your** machine and never sent to the deployment,
because everything the job prints goes to Cloud Logging for thirty days:

```bash
npm run console:user -- --credentials "Their Name"
```

That prints a password to give them directly, and the exact `gcloud` command to
run — which carries only the bcrypt hash. Then:

```bash
gcloud run jobs execute magpie-console-user --region=$REGION --wait --args="--list"
gcloud run jobs execute magpie-console-user --region=$REGION --wait --args="--disable,EMAIL"
```

> Retire the shared `ADMIN_PASSWORD` once every architect has an account — until
> then, reviews made with it are attributed to "console admin". Leave the email
> blank on the sign-in form to use it.

## When it goes wrong

**`Error: google: could not find default credentials`**

You ran `gcloud auth login` but not `gcloud auth application-default login`. Run the second one — see Step 2.

**`Invalid Tier (db-g1-small) for (ENTERPRISE_PLUS) Edition`**

You are not using this configuration, or have overridden the edition. Cloud SQL now defaults to Enterprise Plus, which rejects small machines. The configuration sets `edition = "ENTERPRISE"` for exactly this reason — the fix is the edition, not a bigger tier.

**`violates constraint constraints/sql.restrictPublicIp`**

Your organisation forbids public database addresses, which is correct. This configuration already creates a private-IP-only instance. If you see this, something has overridden `ipv4_enabled = false`.

**The Cloud Run revision never becomes ready**

Almost always one of two things. Either the image is arm64 — rebuild with `--platform linux/amd64`. Or the database is unreachable and migrations failed at boot, which the container treats as fatal by design. Check with `gcloud run services logs read magpie --region=$REGION`.

**Signing in to the console always fails**

The password secret probably has a trailing newline. Set it again with `printf`, not `echo`, then force a new revision.

**`Error creating GlobalAddress: already exists`**

A previous partial apply left the private IP range behind. Import it rather than deleting: `tofu import google_compute_global_address.private_ip projects/$PROJECT/global/addresses/magpie-private-ip`.

**The nightly retention sweep does nothing**

Check the job ran: `gcloud scheduler jobs describe magpie-retention --location=$REGION`. A 401 in the logs means the token the job sends and the one the service holds have diverged — re-run `tofu apply` so both come from the same variable.

## What this deliberately does not do

| | |
|---|---|
| **More than one Cloud Run instance** | `max_instances` is pinned to 1. Rate limiting is currently in-process, so a second instance would double the effective limit. This is a correctness constraint, not a capacity choice — do not raise it until rate limiting moves to shared state. |
| **The analysis views** | `enable_tobe` is false, so the to-be map and opportunity overlay are hidden. They produce proposals that require human review, and a pilot audience should not meet them unlabelled. Set it to true only for an architect's own analysis. |
| **A custom domain** | Not needed for a pilot. If you add one later, invite links follow it automatically — the application derives its origin from the request. |
| **Individual console accounts** | The console is one shared password. Review actions are attributed to "console admin". Acceptable for a small known team; it should not survive into wider use. |
