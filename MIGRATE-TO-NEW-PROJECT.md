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
  deleted. Set `allow_public_access = false` and
  `ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"`, and put the load balancer
  in front **before** applying, or the service is unreachable including by you. It
  costs a global load balancer and a domain, and it removes the "no account, no
  training" property the interview face was built around. The switches exist, but
  it is still a change of design rather than a configuration flag — budget for it
  rather than discovering it on the day.

If they can put the pilot behind their VPN instead, that is a third answer and a
good one: drop `allUsers`, keep everything else.

---

## What a corporate project changes

The configuration's defaults describe a project with the auto-created `default`
VPC and an identity that may enable APIs. A fresh project looks like that; an
organisation's project usually does not. None of this needs a fork — each is a
variable — but each needs an answer from whoever runs the platform, and it is
cheaper to ask now than at the apply.

| Ask them | If the answer is not the default | Set |
|---|---|---|
| Does this project have its own VPC, or is it attached to a Shared VPC? | Shared VPC | `network`, `subnetwork`, `network_project_id`, and `manage_private_services_access = false` — the peering belongs to the host project and a second attempt from here fails |
| Which subnet in `europe-west2` is allocated to this workload? | (there is always one) | `subnetwork` |
| May the deploying identity enable APIs, or are they enabled centrally? | Centrally | `manage_apis = false` |
| Is `iam.allowedPolicyMemberDomains` enforced? | Yes | see above — this is the one that can stop you |
| Are custom IAM roles permitted? | No | `vertex_least_privilege = false`, falling back to `roles/aiplatform.user` |

The Shared VPC case also needs `roles/compute.networkUser` on the subnet for this
project's service accounts. That is a grant on *their* host project, so it is
their action, not yours — which is exactly why it is worth asking before the day.

---

## The migration, in order

### 1 · Before you touch anything

Get these three answers first. Each of them changes the plan:

- Will the organisation permit public Cloud Run on this project? (above)
- Do you want the interview data brought across, or a clean start?
- Who holds `roles/owner`, or the equivalent set, on the new project?

### 2 · State bucket

Terraform state contains the database password and the session secret in
cleartext. It belongs in the new project, not the old one — and it is now made by
Terraform rather than by hand, so the new bucket has versioning, uniform access
and public access prevention without anyone having to remember them:

```bash
export NEW=the-new-project-id

cd infra/terraform/bootstrap
tofu init && tofu apply -var project_id=$NEW
cd ..
```

It prints the two lines for `envs/vmo2.backend.hcl`.

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

tofu apply -var-file=envs/vmo2.tfvars -target=google_artifact_registry_repository.magpie
```

Keep that export somewhere durable — a password manager. Losing it means a
rotation, not a disaster, but it is avoidable work. There is no second export any
more: the retention sweep authenticates an identity rather than a token.

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

### 7 · Everything else — read the plan first

```bash
tofu plan -var-file=envs/vmo2.tfvars    # read it
tofu apply -var-file=envs/vmo2.tfvars
```

Roughly fifteen minutes, nearly all of it Cloud SQL.

**Read the plan.** Not as diligence-theatre — this configuration has once produced
a plan that would have destroyed the database, and only `deletion_protection`
caught it. On a fresh project every line is a create, so anything that is *not* a
create is worth stopping for. On an existing project, see "Applying the hardening
to an environment that already exists" below.

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

curl -s -X POST \
  -H "Authorization: Bearer $(gcloud auth print-identity-token --audiences=$URL)" \
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

---

## The hardening that travels with this (added 2026-08-23)

Written after a security review of the pilot. It is all in the code above, so it
arrives at the new project by being applied — nothing here is a separate exercise
to schedule. It is listed because two items change how you operate the deployment,
and three are unproven and worth watching on the first apply.

### Changes how you operate it

| | Before | Now |
|---|---|---|
| **Retention sweep** | A shared token, sent in a header the scheduler held in clear text | The caller's Google identity, verified. Add yourself to `retention_callers` to run it by hand — see step 9. There is no `TF_VAR_retention_token` any more, and the old `magpie-retention-token` secret is deleted on apply |
| **State bucket** | Created by hand with `gcloud`, remembering to turn versioning on | `bootstrap/` module — step 2. Versioning, uniform access and enforced public-access prevention are properties of the code |

### Applied silently, nothing to do

- The database carries `prevent_destroy`, so a plan that would replace it fails to
  generate rather than waiting for someone to notice it in the output.
- Vertex runs under a custom role holding `aiplatform.endpoints.predict` alone,
  instead of `roles/aiplatform.user` — which also permits creating datasets,
  training jobs and endpoints.
- The account-administration job has its own service account. It previously ran as
  the service's, which holds the model key and the console password, so "run the
  account tool" was a route to every other secret in the deployment.
- The image carries production dependencies only — 1.1G to 663M, and the entire
  test toolchain out of an internet-facing container.
- The application-layer fixes (CSP nonce, CSRF on every cookie-authenticated POST,
  no raw exception text, no timing signal on sign-in, entity ids scoped to their
  project) are in the image and need no infrastructure.

### Unproven — watch these on the first apply

1. **The narrow Vertex role.** `aiplatform.endpoints.predict` is the right
   permission on paper for a publisher-model call, but no apply has tested it. If
   transcription starts returning 403, set `vertex_least_privilege = false` and
   apply — that restores `roles/aiplatform.user` immediately. Test transcription
   deliberately rather than waiting for an informant to find it: open an interview
   and record one spoken answer.
2. **The Shared VPC path.** `network`, `subnetwork`, `network_project_id` and
   `manage_private_services_access` are written but have never run against a real
   Shared VPC, because there is not one to test against. If the platform team hands
   you one, the first apply is the test — and the failure to expect is the peering,
   not the app.
3. **`manage_apis = false`.** Where a platform team enables APIs centrally, a
   missing one surfaces as that API's own error at whichever resource needs it,
   rather than as a clear message here. Not a defect — the alternative was a
   permission denial that named nothing — but know what you are reading.

### Applying the hardening to an environment that already exists

This matters for the proving environment, which stays running. Some of the above
adds `count` to resources that are already there, and putting `count` on an
existing resource renames it in state: `foo.bar` becomes `foo.bar[0]`. Terraform
reads that as one resource gone and another arrived — a destroy and a create. On
the peering range that would take the database's private address with it.

`moved.tf` declares those renames, so the plan should say **three moves and no
destroys**:

```
tofu plan -var-file=envs/<env>.tfvars

  # expect, and nothing else destructive:
  google_compute_global_address.private_ip              has moved to ...[0]
  google_service_networking_connection.private_vpc      has moved to ...[0]
  google_cloud_run_v2_service_iam_member.public         has moved to ...[0]

  # expected destroys, both deliberate:
  google_secret_manager_secret.retention_token          (no longer used)
  google_secret_manager_secret_version.retention_token
```

If you see a destroy or replacement of `google_sql_database_instance.magpie`,
`google_compute_global_address.private_ip` or
`google_service_networking_connection.private_vpc` — **stop**. That is the failure
this file exists to prevent, and it means a `moved` block did not match.
