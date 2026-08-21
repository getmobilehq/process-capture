# Moving Magpie to another GCP project

The infrastructure moves with one `apply`. Everything in `infra/terraform` is
parameterised by `project_id`, so a second environment is a second variables file
rather than a second copy of the code.

Three things do **not** move by themselves, and one of them may not be grantable
at all. Read "The one that can stop you" before booking a date.

---

## What actually moves

| | How |
|---|---|
| **Infrastructure** | `tofu apply` with a new var-file. Cloud SQL, networking, secrets, Cloud Run, the retention job, the account job. |
| **Application** | Unchanged. Nothing in the code names a project. |
| **Container image** | Rebuild and push to the new project's Artifact Registry. |
| **Invite links** | Take care of themselves — the app derives its origin from the request, so links carry whatever hostname the new service has. Links already issued on the old URL stop working. |

| Does not move by itself | What to do |
|---|---|
| **Terraform state** | New bucket in the new project. State holds secrets — it does not follow you. |
| **The two out-of-band secrets** | Model API key and console password, set by hand. |
| **Interview data** | Only if you want it. See "Taking the data with you". |
| **The org-policy exception** | Needs org-policy admin in the *new* organisation. This is the risk. |

---

## The one that can stop you

Magpie's interview face has no login by design — an informant opens a tokenised
link. So Cloud Run must accept unauthenticated requests, which means an
`allUsers` IAM binding.

Most organisations enforce `constraints/iam.allowedPolicyMemberDomains`, which
refuses that binding. In your own organisation you granted a project-scoped
exception. **In the client's organisation you will not be able to grant it
yourself, and they may say no** — "make this internet-facing" is a real thing to
ask a security team, and `allowAll` on that constraint is broader than it sounds:
it also removes the guard that would refuse a public state bucket or a public
secret in the same project.

Ask early. The answer determines the shape of the deployment:

- **Permitted** → apply `infra/terraform/allow-public-access.example.yaml` with the
  new project id, and everything below works as written.
- **Refused** → the answer is **Identity-Aware Proxy**: informants sign in with
  their own account, the org policy is untouched, and the exception file is
  deleted. It costs a global load balancer and a domain, and it removes the "no
  account, no training" property the interview face was built around. It is a
  change of design, not a configuration flag — budget for it rather than
  discovering it on the day.

If they can put the pilot behind their VPN instead, that is a third answer and a
good one: drop `allUsers`, keep everything else.

---

## The migration, in order

### 1 · Before you touch anything

Get these three answers first. Each of them changes the plan:

- Will the organisation permit public Cloud Run on this project? (above)
- Do you want the interview data brought across, or a clean start?
- Who holds `roles/owner`, or the equivalent set, on the new project?

### 2 · State bucket

Terraform state contains the database password, the retention token and the
session secret in cleartext. It belongs in the new project, not the old one.

```bash
export NEW=the-new-project-id
export REGION=europe-west2

gcloud storage buckets create gs://$NEW-tfstate \
  --project=$NEW --location=$REGION --uniform-bucket-level-access
gcloud storage buckets update gs://$NEW-tfstate --versioning
```

### 3 · Environment files

Two small files, copied from the examples:

```bash
cd infra/terraform
sed "s/YOUR-PROJECT/$NEW/" envs/example.backend.hcl > envs/vmo2.backend.hcl
sed "s/your-gcp-project/$NEW/g" envs/example.tfvars   > envs/vmo2.tfvars
```

Then edit `envs/vmo2.tfvars` — at minimum the `image` tag, which step 5 gives you.

### 4 · Registry first

Cloud Run needs an image and the image needs somewhere to go, so create the
registry before anything else:

```bash
tofu init -backend-config=envs/vmo2.backend.hcl -reconfigure
export TF_VAR_db_password="$(openssl rand -base64 24)"
export TF_VAR_retention_token="$(openssl rand -hex 32)"

tofu apply -var-file=envs/vmo2.tfvars -target=google_artifact_registry_repository.magpie
```

Keep those two exports somewhere durable — a password manager. Losing them means
a rotation, not a disaster, but it is avoidable work.

### 5 · Build and push

```bash
REPO=$(tofu output -raw image_repository)
TAG=$REPO/magpie:$(date +%Y-%m-%d)
gcloud auth configure-docker ${REGION}-docker.pkg.dev
docker build --platform linux/amd64 -t $TAG ../..
docker push $TAG
```

`--platform linux/amd64` is not optional on an Apple Silicon machine. Cloud Run
cannot run an arm64 image and the failure does not say so — the revision simply
never becomes ready.

Put `$TAG` into `envs/vmo2.tfvars` as `image`.

### 6 · The org policy, if permitted

```bash
sed "s/PROJECT_ID/$NEW/" allow-public-access.example.yaml > /tmp/policy.yaml
gcloud org-policies set-policy /tmp/policy.yaml --project=$NEW
```

If this is refused, stop and settle the IAP question before continuing — the
apply will otherwise succeed with a service nobody outside the project can reach.

### 7 · Everything else

```bash
tofu apply -var-file=envs/vmo2.tfvars
```

Roughly fifteen minutes, nearly all of it Cloud SQL.

### 8 · The two secrets Terraform never holds

```bash
printf 'sk-ant-...'   | gcloud secrets versions add magpie-anthropic-api-key --project=$NEW --data-file=-
printf 'a-strong-one' | gcloud secrets versions add magpie-admin-password    --project=$NEW --data-file=-

gcloud run services update magpie --project=$NEW --region=$REGION \
  --update-labels=secrets-set=$(date +%s)
```

`printf`, not `echo` — a trailing newline becomes part of the secret and produces
a console password that silently never works.

### 9 · Check it, then arm retention

```bash
URL=$(tofu output -raw service_url)
curl -s $URL/health
open $URL/console

curl -s -X POST -H "X-Retention-Token: $TF_VAR_retention_token" \
  "$URL/api/admin/retention?dryRun=1"
```

### 10 · Console accounts

Create the first one through the job, then the rest from **console → People**:

```bash
npm run console:user -- --credentials "Their Name"   # generates locally
gcloud run jobs execute magpie-console-user --project=$NEW --region=$REGION --wait \
  --args="--add,someone@example.com,--name,Their Name,--hash,<the hash it printed>"
```

The password is generated on your machine and never sent to the job, because
everything the job prints lands in Cloud Logging for thirty days.

---

## Taking the data with you

Only if you want it. The current environment holds test campaigns and simulated
interviews, and a clean start is usually the better answer — but the mechanism is
here if you need it.

```bash
# Export from the old project into a bucket the new project can read.
gcloud sql export sql magpie-db gs://$NEW-tfstate/migrate/magpie.sql \
  --project=magpie-505120 --database=magpie

# Grant the new instance's service account read on that object, then:
gcloud sql import sql magpie-db gs://$NEW-tfstate/migrate/magpie.sql \
  --project=$NEW --database=magpie
```

Two cautions. **Import into a freshly migrated, empty schema** — the container runs
migrations at boot, so let it start once before importing, and expect conflicts if
you import over data. And **the data contains real names and work email
addresses**, so moving it between organisations is a data-protection decision, not
a technical one. If in doubt, start clean: it costs one seeded campaign.

---

## What changes about the pilot

- **The URL changes.** Any invite link already issued stops working. Re-issue from
  the register; nothing is lost because a link is just a token in a URL.
- **The pen test becomes due.** You deferred it deliberately until the real
  environment existed. This is that environment.
- **`SESSION_SECRET` regenerates**, so everyone signs in again. Expected.
- **The retention sweep starts from nothing** — no interview is old enough to
  expire, which is why step 9 reports zeroes.

---

## Known benign drift

`tofu plan` may report one in-place change to `google_cloud_run_v2_service` that
removes an empty `scaling` block with zero values. That is a provider artefact, not
configuration — the block is not in our code. Applying it changes nothing.
