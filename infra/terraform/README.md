# Magpie on Google Cloud — Terraform

Declarative equivalent of `DEPLOY-GCP.md`. One `apply` builds the lot: private
Cloud SQL, secrets, Artifact Registry, Cloud Run, and the nightly retention sweep.

> **Following this for the first time?** `DEPLOY-TERRAFORM.md` in the repository root
> is the full step-by-step runbook, including tool installation, authentication and
> troubleshooting. This file is the short version for someone who already has the
> tools and the credentials.

Terraform does **not** build the container image. Infrastructure and application
releases move at different rates, and coupling them makes both harder to reason
about — build and push first, then apply with the tag.

## Before the first apply

State holds the database password and the retention token, because Terraform must
know both to manage the SQL user and the scheduler job. **Put state in a bucket,
not on a laptop**, then uncomment the backend in `versions.tf`:

```bash
gcloud storage buckets create gs://$PROJECT-tfstate \
  --location=europe-west2 --uniform-bucket-level-access
gcloud storage buckets update gs://$PROJECT-tfstate --versioning
```

## 1 · Configure

```bash
cp terraform.tfvars.example terraform.tfvars   # edit project_id and image
export TF_VAR_db_password="$(openssl rand -base64 24)"
export TF_VAR_retention_token="$(openssl rand -hex 32)"
```

Keep those two exports somewhere you can find them again — a rotation means a new
`apply`, not a lost deployment.

## 2 · Create the registry, then push an image

The registry has to exist before there is anywhere to push to, so target it first:

```bash
terraform init
terraform apply -target=google_artifact_registry_repository.magpie

REPO=$(terraform output -raw image_repository)
TAG=$REPO/magpie:$(date +%Y-%m-%d)
gcloud auth configure-docker europe-west2-docker.pkg.dev
docker build --platform linux/amd64 -t $TAG ../..
docker push $TAG
```

Then set `image = "<TAG>"` in `terraform.tfvars`.

> `--platform linux/amd64` matters if you build on an Apple Silicon machine.
> Cloud Run will not run an arm64 image and the failure is not obvious.

## 3 · Apply

```bash
terraform apply
```

Roughly fifteen minutes, nearly all of it Cloud SQL.

## 4 · Fill the two secrets Terraform does not

The model key and the console password are never in Terraform state — set their
values directly, and they are read at `:latest` on the next revision:

```bash
printf 'sk-ant-...'   | gcloud secrets versions add magpie-anthropic-api-key --data-file=-
printf 'a-strong-one' | gcloud secrets versions add magpie-admin-password --data-file=-

gcloud run services update magpie --region=europe-west2 \
  --update-labels=secrets-set=$(date +%s)   # forces a new revision
```

## 5 · Check it

```bash
URL=$(terraform output -raw service_url)
curl -s $URL/health                # {"status":"ok",...}
open $URL/console
```

Invite links carry whichever hostname you reached the console on — the app derives
its origin from the request, so there is no second deploy to set `BASE_URL`. Put a
custom domain in front and links follow it automatically. Set `BASE_URL` only if
you want to override that.

## 6 · Prove the retention sweep before trusting it

The scheduler runs nightly at 02:30. Run it once by hand in report mode first —
it tells you what would go without touching anything:

```bash
curl -s -X POST -H "X-Retention-Token: $TF_VAR_retention_token" \
  "$URL/api/admin/retention?dryRun=1"
```

## What is deliberately not here

| | |
|---|---|
| **Image build** | See above. Belongs to CI, not to infrastructure state. |
| **`max_instances` above 1** | Rate limiting is in-process (SDD issue I-1), so a second instance doubles the effective limit. This is a correctness constraint, not a capacity choice. |
| **Analysis views** | `enable_tobe` is false. The to-be map and opportunity overlay are proposals until a human has reviewed them, and a pilot audience should not meet them unlabelled. |
| **Custom domain and load balancer** | Not needed for a pilot; the app already follows whatever hostname is in front of it. |

## Undoing it

`deletion_protection` on the database is on, deliberately. To tear down a test
environment, set it to `false`, apply, then destroy — two steps, so it cannot
happen by accident.
