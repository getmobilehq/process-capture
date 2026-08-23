# Magpie on Google Cloud — Terraform

Declarative equivalent of `DEPLOY-GCP.md`. One `apply` builds the lot: private
Cloud SQL, secrets, Artifact Registry, Cloud Run, and the nightly retention sweep.

> **Moving to a different GCP project?** See `MIGRATE-TO-NEW-PROJECT.md` in the
> repository root. The short version: `envs/<name>.backend.hcl` plus
> `envs/<name>.tfvars`, and nothing in the code names a project.

> **Following this for the first time?** `DEPLOY-TERRAFORM.md` in the repository root
> is the full step-by-step runbook, including tool installation, authentication and
> troubleshooting. This file is the short version for someone who already has the
> tools and the credentials.

Terraform does **not** build the container image. Infrastructure and application
releases move at different rates, and coupling them makes both harder to reason
about — build and push first, then apply with the tag.

## Before the first apply

State holds the database password, because Terraform must know it to manage the
SQL user. **Put state in a bucket, not on a laptop.** The `bootstrap/` module
creates that bucket with versioning, uniform access and public access prevention
already on, so it is the same bucket in every environment rather than whatever
the last person remembered to type:

```bash
cd bootstrap
tofu init && tofu apply -var project_id=$PROJECT
cd ..
```

It prints the two lines to put in `envs/<name>.backend.hcl`. Then:

```bash
tofu init -backend-config=envs/<name>.backend.hcl
```

## 1 · Configure

> **One variables file, always named.** There is deliberately no
> `terraform.tfvars`: Terraform auto-loads that filename, and an auto-loaded file
> silently overrides the `-var-file` you passed. That is not hypothetical — it
> failed an apply here by holding a stale image tag while the named file held the
> new one, and in CI it would have deployed the wrong image without erroring.
> Every command below passes `-var-file` explicitly. Keep it that way.

```bash
cp envs/example.tfvars envs/<name>.tfvars    # edit project_id and image
export TF_VAR_db_password="$(openssl rand -base64 24)"
```

Keep that somewhere you can find it again — a rotation means a new `apply`, not a
lost deployment. There is no retention token to keep any more: the sweep
authenticates the caller's identity instead (see §6).

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

Then set `image = "<TAG>"` in `envs/<name>.tfvars`.

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

Nothing shared is sent. The endpoint verifies a Google-signed identity token and
checks the identity against `RETENTION_CALLERS`, which always contains the
scheduler's service account. To run it as yourself, add your address to
`retention_callers` in your tfvars, apply, then:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $(gcloud auth print-identity-token --audiences=$URL)" \
  "$URL/api/admin/retention?dryRun=1"
```

## What is deliberately not here

| | |
|---|---|
| **Image build** | See above. Belongs to CI, not to infrastructure state. |
| **Image build** | Belongs to CI, not to infrastructure state. |
| **Analysis views** | `enable_tobe` is false. The to-be map and opportunity overlay are proposals until a human has reviewed them, and a pilot audience should not meet them unlabelled. |
| **Custom domain and load balancer** | Not needed for a pilot; the app already follows whatever hostname is in front of it. |

## Deploying into an organisation's project

The defaults describe a project with the auto-created `default` VPC and no policy
against public services — which is what a fresh project looks like, and what the
proving environment is. A corporate project usually differs in four ways, and each
one is a variable rather than a fork:

| What is different | Set |
|---|---|
| No `default` network; a Shared VPC instead | `network`, `subnetwork`, `network_project_id`, and `manage_private_services_access = false` — the host project's team owns the peering |
| APIs enabled centrally, no serviceusage rights | `manage_apis = false` |
| `iam.allowedPolicyMemberDomains` forbids `allUsers` | `allow_public_access = false`, and put an authenticating load balancer in front **first** |
| Public ingress refused | `ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"` |

The last two change how informants reach an invite link, so they are a
conversation with the platform team before they are a config change. Everything
else in this configuration is unaffected.

## Undoing it

`deletion_protection` on the database is on, deliberately. To tear down a test
environment, set it to `false`, apply, then destroy — two steps, so it cannot
happen by accident.
