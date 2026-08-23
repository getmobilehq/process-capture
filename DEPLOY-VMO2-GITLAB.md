# Magpie at VMO2 — from archive to running pilot

A single path to follow, in order, from the zip on your personal machine to a
deployment VMO2's own pipeline owns. Written for the situation you are actually
in: GitLab is being stood up for CI/CD, the code has to reach your official
machine as an archive, and the GCP project will be one VMO2 gives you rather than
one you control.

Everything here has been done once already, on `magpie-505120`. Where something
has never been tested, it says so.

**Read section 0 before you book a date.** Three of its answers are not yours to
give, and each has a lead time.

---

## 0 · What to ask VMO2 first

None of this is work. It is five questions, and the answers change the shape of
what follows. Ask them all in one message, on the same day you start.

| Question | Why it matters | If the answer is not the easy one |
|---|---|---|
| **Will you permit Workload Identity Federation from GitLab to GCP?** | It is how the pipeline authenticates without a permanent key | The fallback is a service account JSON key in a CI variable. Most security teams refuse it. If they do, WIF is not optional and you wait for it |
| **Will you permit an `allUsers` invoker binding on Cloud Run?** | Informants open a tokenised link with no Google account | `allow_public_access = false`, plus a load balancer with IAP in front. That removes the "no account, no training" property the interview face was built on. It is a design change, not a flag |
| **Does the project have its own VPC, or is it on a Shared VPC?** | Cloud SQL needs private services access | Shared VPC: set `network`, `subnetwork`, `network_project_id`, `manage_private_services_access = false` — **and they must grant `roles/compute.networkUser` on the subnet.** Their action, not yours |
| **May the deploying identity enable APIs?** | Terraform enables eleven | `manage_apis = false`, and they enable them centrally first |
| **Are custom IAM roles permitted?** | Vertex runs under a custom least-privilege role | `vertex_least_privilege = false`, falling back to `roles/aiplatform.user` |

Also settle two things internally:

- **Whose Anthropic account pays?** The model key must be VMO2's, not yours. A
  pilot running on a personal key is a conversation you do not want to have later.
- **Does any pilot data move?** Recommendation: **no.** Start clean. The existing
  interviews contain real names and work email addresses, and moving them between
  organisations is a data-protection decision, not a technical one. A clean start
  costs one seeded campaign.

---

## 1 · Make the archive

On your personal machine, in the project folder.

### What must not travel

Four files are deliberately outside git, and three of them hold secrets:

- `.env` — fourteen keys including `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `ADMIN_PASSWORD`, `SESSION_SECRET`
- `infra/terraform/envs/univelcity.tfvars`
- `infra/terraform/envs/univelcity.backend.hcl`
- `infra/terraform/.terraform/` — provider binaries and a pointer to *your* state

None of them are wanted at VMO2. The keys must be reissued under VMO2's accounts
and the environment files describe your project. Leaving them in the archive is
the single most likely way to leak a credential in this whole exercise.

### The command

```bash
cd ~/Desktop/studio/reddy

git archive --format=zip --prefix=magpie/ -o ~/magpie-source.zip HEAD
```

`git archive` takes only what git tracks, so every ignored file — `.env`,
`node_modules`, `.next`, the env files, Terraform's working directory — is
excluded by construction rather than by you remembering. That is why it is the
right tool here.

**Commit anything you want to carry before running it.** `git archive HEAD`
exports the last commit, not your working tree.

### If you want the history too

The commit history is not required — `DECISIONS.md` and `STATUS.md` carry the
reasoning in-tree — but it is useful provenance, and it is only about 48 MB:

```bash
cd ~/Desktop/studio
zip -r ~/magpie-with-history.zip reddy \
  -x "reddy/node_modules/*" "reddy/.next/*" "reddy/.next-e2e/*" \
     "reddy/infra/terraform/.terraform/*" "reddy/.env" \
     "reddy/infra/terraform/envs/univelcity.*" \
     "reddy/test-results/*" "reddy/playwright-report/*"
```

**Check it before it leaves the machine:**

```bash
unzip -l ~/magpie-with-history.zip | grep -E "\.env$|univelcity" && echo "STOP — secrets in the archive" || echo "clean"
```

### What is in it

About 55 MB zipped, 890 files. Half of it is material rather than code: 24 MB
`VMO2 Design System` and 24 MB `reference/`. Those are VMO2's own materials — Aeonik Pro is VMO2-licensed — so
they belong in VMO2's GitLab more properly than they belong where they are now.
Check whether their GitLab has a file-size or LFS policy before the first push.

---

## 2 · On the official machine

Unpack, then confirm it is whole before trusting it.

```bash
unzip magpie-source.zip -d ~/work
cd ~/work/magpie

node --version        # needs 20 or later
npm ci
npm run typecheck
npm test
```

If `npm test` passes — 357 tests at the time of writing — the archive is intact
and the toolchain works. That is the whole check; nothing further is needed at
this stage.

You do **not** need Docker on this machine. Building images moves to the GitLab
runner, which is one of the real gains of this change.

---

## 3 · Create the GitLab project and push

```bash
cd ~/work/magpie

# If you used git archive, there is no history — start one.
git init
git add -A
git commit -m "feat: Magpie SME interview tool, initial import"

git remote add origin https://gitlab.<vmo2-domain>/<group>/magpie.git
git push -u origin main
```

If you carried the history, just re-point the remote:

```bash
git remote set-url origin https://gitlab.<vmo2-domain>/<group>/magpie.git
git push -u origin main
```

The pipeline definition (`.gitlab-ci.yml`) is already in the repository, so the
first push will try to run it. Expect it to fail on missing variables — that is
section 6, and it is fine.

> **Protect `main` immediately.** The pipeline applies infrastructure from that
> branch. Settings → Repository → Protected branches.

---

## 4 · GCP prerequisites

Two things must exist before the pipeline can do anything, and neither can be
created by the pipeline: somewhere to keep Terraform state, and an identity for
the pipeline to be.

Run these from wherever you have `gcloud` and `tofu` — your own machine is fine,
using the VMO2 project id.

```bash
export PROJECT=<the-vmo2-project-id>
export REGION=europe-west2
gcloud config set project $PROJECT
```

### 4.1 State bucket

```bash
cd infra/terraform/bootstrap
tofu init
tofu apply -var project_id=$PROJECT
```

It creates the bucket with versioning, uniform access and enforced public-access
prevention, and prints the two lines you need next. State holds the database
password, so those three properties are not optional — which is exactly why this
is a module and not a remembered `gcloud` command.

### 4.2 The deploy identity

```bash
gcloud iam service-accounts create magpie-deploy \
  --display-name="Magpie GitLab deployer"

export DEPLOY_SA=magpie-deploy@$PROJECT.iam.gserviceaccount.com

for ROLE in roles/run.admin roles/cloudsql.admin roles/secretmanager.admin \
            roles/artifactregistry.admin roles/iam.serviceAccountAdmin \
            roles/iam.serviceAccountUser roles/cloudscheduler.admin \
            roles/compute.networkAdmin roles/monitoring.editor \
            roles/storage.objectAdmin roles/iam.roleAdmin \
            roles/serviceusage.serviceUsageAdmin; do
  gcloud projects add-iam-policy-binding $PROJECT \
    --member="serviceAccount:$DEPLOY_SA" --role="$ROLE" --condition=None
done
```

> Two of these will be argued about, reasonably. `roles/iam.roleAdmin` exists only
> to create the custom Vertex role — drop it and set
> `vertex_least_privilege = false`. `roles/serviceusage.serviceUsageAdmin` exists
> only to enable APIs — drop it and set `manage_apis = false`, having asked them to
> enable the eleven in `services.tf` centrally. Offer both trades before they ask.

---

## 5 · Workload Identity Federation

This is how the pipeline authenticates with no stored key. If VMO2 said no, skip
to 5.3.

### 5.1 Pool and provider

```bash
gcloud iam workload-identity-pools create gitlab \
  --location=global --display-name="GitLab CI"

export GITLAB_HOST=gitlab.<vmo2-domain>       # or gitlab.com

gcloud iam workload-identity-pools providers create-oidc gitlab-oidc \
  --location=global --workload-identity-pool=gitlab \
  --issuer-uri="https://${GITLAB_HOST}" \
  --attribute-mapping="google.subject=assertion.sub,attribute.project_path=assertion.project_path,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.project_path=='<group>/magpie'"
```

The `attribute-condition` is the security boundary: without it, **any** project on
that GitLab instance can assume this identity. Do not omit it, and make it exact.

### 5.2 Let the pool impersonate the deploy account

```bash
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')

gcloud iam service-accounts add-iam-policy-binding $DEPLOY_SA \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/gitlab/attribute.project_path/<group>/magpie"
```

Tighten later with `attribute.ref` so only the default branch may deploy.

### 5.3 If WIF was refused

```bash
gcloud iam service-accounts keys create /tmp/magpie-deploy.json \
  --iam-account=$DEPLOY_SA
```

Add it to GitLab as a **file**-type, **masked**, **protected** CI variable named
`GCP_SA_KEY`, then delete the local copy. The pipeline supports both paths and
picks whichever is configured.

This key never expires. Put a calendar reminder to rotate it, and treat WIF as
outstanding work rather than as a decision that has been made.

---

## 6 · GitLab CI/CD variables

Settings → CI/CD → Variables. Mark them **Protected**; none needs masking except
the key, if you are using one.

| Variable | Value |
|---|---|
| `GCP_PROJECT_ID` | the VMO2 project id |
| `GCP_PROJECT_NUMBER` | `gcloud projects describe $PROJECT --format='value(projectNumber)'` |
| `GCP_REGION` | `europe-west2` |
| `GCP_SERVICE_ACCOUNT` | `magpie-deploy@<project>.iam.gserviceaccount.com` |
| `TF_STATE_BUCKET` | printed by step 4.1 |
| `TF_ENV` | `vmo2` |
| `GCP_WIF_POOL` | `gitlab` — WIF only |
| `GCP_WIF_PROVIDER` | `gitlab-oidc` — WIF only |
| `GCP_SA_KEY` | file variable — key path only |
| `TF_VAR_db_password` | `openssl rand -base64 24`, masked and protected |

`TF_VAR_db_password` is the one to record in a password manager. Losing it means a
rotation, not a disaster, but it is avoidable work.

---

## 7 · The environment file

```bash
cd infra/terraform
cp envs/example.tfvars envs/vmo2.tfvars
```

Edit it. At minimum `project_id`; add whatever section 0 turned up:

```hcl
project_id = "vmo2-magpie-prod"
region     = "europe-west2"

enable_tobe = true
alert_email = "you@virginmediao2.co.uk"

# Only if the Shared VPC answer was yes:
# network                        = "shared-vpc-prod"
# subnetwork                     = "magpie-euw2"
# network_project_id             = "vmo2-host-project"
# manage_private_services_access = false

# Only if those answers were no:
# manage_apis            = false
# allow_public_access    = false
# ingress                = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
# vertex_least_privilege = false
```

Note there is **no `image` line**. The pipeline passes `-var image=...` with the
commit it built, so the deployed image always names the commit it came from.

> **There is deliberately no `terraform.tfvars`.** Terraform auto-loads that
> filename and it silently overrides the `-var-file` you passed. That is not
> theoretical: it failed an apply here by holding a stale image tag. Do not
> recreate it.

`envs/*.tfvars` is gitignored, so committing it takes a deliberate `git add -f`.
It holds no secrets — commit it if VMO2 prefers configuration in the repo, or
leave it local and mirror the values into CI variables.

---

## 8 · First pipeline run: verify only

Push. The `test` and `e2e` jobs should pass with no GCP access at all — they use
an in-process Postgres for units and a service container for E2E.

If `e2e` fails, it is almost always the runner lacking browser dependencies.
`npx playwright install --with-deps chromium` is already in the job; if the runner
forbids apt, ask for the Playwright image to be allowed instead.

**Do not proceed until verify is green.** Everything after this point costs money
or changes infrastructure.

---

## 9 · The registry, once, by hand

The `build` job pushes to Artifact Registry, and Artifact Registry is created by
Terraform. Something has to break that circle once.

```bash
cd infra/terraform
tofu init -backend-config="bucket=<state-bucket>" -backend-config="prefix=magpie"
export TF_VAR_db_password="<the one you put in CI>"

tofu apply -var-file=envs/vmo2.tfvars -var image=placeholder \
  -target=google_artifact_registry_repository.magpie
```

`image=placeholder` is safe here because `-target` builds only the registry;
nothing reads the image.

*If you cannot run `tofu` on the official machine*, create it with gcloud and
adopt it instead:

```bash
gcloud artifacts repositories create magpie \
  --repository-format=docker --location=$REGION

tofu import -var-file=envs/vmo2.tfvars -var image=placeholder \
  google_artifact_registry_repository.magpie \
  projects/$PROJECT/locations/$REGION/repositories/magpie
```

---

## 10 · First deployment

Push to `main`. The pipeline runs `test` → `e2e` → `build` → `plan`, then stops.

**Read the plan.** The job prints it in full and saves it as an artefact. On a new
project every line is a create, so anything that is not a create deserves a pause.
The `plan` job also fails on its own if it sees a destroy of the database, the
peering address or the peering connection — that guard exists because this
configuration has once produced exactly that plan, and only `deletion_protection`
stopped it.

When the plan reads correctly, click **deploy**. About fifteen minutes, nearly all
of it Cloud SQL.

If it fails part way, run it again — Terraform picks up where it stopped.

---

## 11 · The two secrets Terraform never holds

Terraform creates the containers and never the values, so the model key and
console password are not in state, in plan output, or in a file on a laptop.

```bash
printf 'sk-ant-...'   | gcloud secrets versions add magpie-anthropic-api-key --data-file=-
printf 'a-strong-one' | gcloud secrets versions add magpie-admin-password    --data-file=-

gcloud run services update magpie --region=$REGION \
  --update-labels=secrets-set=$(date +%s)
```

`printf`, not `echo`. A trailing newline becomes part of the secret and produces a
console password that silently never works. This has happened.

The label update is only there to force a new revision so the secrets are picked
up.

---

## 12 · Console accounts

The database has a private address only, so no laptop can reach it — which is the
point. Account administration runs as a Cloud Run job on the same VPC.

```bash
# Generate the password locally. It never goes to the job, because everything the
# job prints lands in Cloud Logging for thirty days.
npm run console:user -- --credentials "Their Name"

gcloud run jobs execute magpie-console-user --region=$REGION --wait \
  --args="--add,someone@virginmediao2.co.uk,--name,Their Name,--hash,<the hash it printed>"
```

Make your own account first, then the rest from **console → People**.

> The domain is `@virginmediao2.co.uk`. The application warns on near-miss domains
> because two accounts were once created at `@virginmedia.co.uk` and could not sign
> in, with nothing to explain why.

---

## 13 · Prove it works

In this order. Each one has failed at least once in a way the previous check would
not have caught.

```bash
URL=$(tofu output -raw service_url)

# 1 · The service is up and migrations ran.
curl -s $URL/health                      # {"status":"ok",...}

# 2 · The console renders and the strict CSP is live.
curl -sI $URL/console/login | grep -i content-security-policy
#   expect: script-src 'self' 'nonce-...' 'strict-dynamic'
#   NOT 'unsafe-inline' — that would mean middleware.ts is not running

# 3 · Cross-site requests are refused.
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Origin: https://evil.example' $URL/api/transcribe        # expect 403

# 4 · The retention route exists and demands an identity.
curl -s -o /dev/null -w '%{http_code}\n' -X POST $URL/api/admin/retention
#   expect 401. A 404 means RETENTION_CALLERS never reached the container.
```

Then two that need a browser:

**5 · Sign in and run an interview.** Create a campaign, add yourself, open the
invite link, answer a few questions. This exercises the model key, the database
and the interview engine together.

**6 · Record a spoken answer.** This is the one to do deliberately, because it is
the least proven thing in the deployment. Voice-to-text runs on Vertex under a
custom role holding only `aiplatform.endpoints.predict`. That is the correct
permission on paper, but **it has never been confirmed against a live Vertex
call**. If transcription returns 403, the fix is one line:

```hcl
vertex_least_privilege = false     # in envs/vmo2.tfvars
```

Push, plan, deploy. It restores `roles/aiplatform.user` and transcription works
again.

**7 · Prove the retention sweep before trusting it.** It deletes interview
content, so run it in report mode first:

```bash
gcloud scheduler jobs run magpie-retention --location=$REGION
gcloud scheduler jobs describe magpie-retention --location=$REGION
```

On a new deployment it reports zeroes, because nothing is old enough to expire.
Zeroes with a 200 is the pass. A 401 means the scheduler's identity is not in
`RETENTION_CALLERS`, or its OIDC audience is not the service URL.

---

## 14 · Running the pilot

- Invite links carry whatever hostname the service has, so they need no
  configuration. Issue them from the register.
- An interview is 25–40 minutes. Tell people that.
- **Warm the process map before an audience sees it.** The first draw costs a
  model call and takes a moment; afterwards it is stored and instant.
- Analysis views (to-be map, opportunity overlay, automation assessment, autonomy
  levels) are on if `enable_tobe = true`. They are labelled *proposed and
  unverified* by construction. Leave that label alone — it is what makes them
  honest.

---

## 15 · When something goes wrong

Every one of these has actually happened.

| Symptom | Cause | Fix |
|---|---|---|
| Revision never becomes ready, no useful error | An arm64 image. Cloud Run cannot run it and does not say so | Only builds from an Apple Silicon laptop. The pipeline builds on a Linux runner, so this cannot recur through CI |
| `Invalid Tier (db-g1-small) for (ENTERPRISE_PLUS)` | The API now defaults to Enterprise Plus | Already fixed: `edition = "ENTERPRISE"` in `database.tf` |
| `constraints/sql.restrictPublicIp` blocks the apply | Correct policy, and this configuration already satisfies it | The database has no public IP. If it still fails, the peering has not been created — check `manage_private_services_access` |
| Login form does nothing, no error | A CSP `form-action` refusal after an absolute redirect to the container's internal address | Already fixed: redirects are relative (`lib/origin.ts`). If it recurs, check middleware is running |
| Apply fails: "value saved in the plan file for variable is different" | An auto-loaded `terraform.tfvars` overriding `-var-file` | Delete `terraform.tfvars`. It should not exist |
| Terraform proposes destroying the database | A data source made "known after apply", cascading to the network | Stop. Do not apply. The `plan` job now fails on this automatically |
| Transcription 403s | The custom Vertex role | `vertex_least_privilege = false` |
| `gcloud` commands fail, Terraform works | Your gcloud user credential expired; ADC is separate and still valid | `gcloud auth login` |
| Pipeline: "unable to exchange token" | The WIF audience string does not match the provider | Compare `aud:` in `.gitlab-ci.yml` against the provider exactly |

### Rolling back a bad deployment

Cloud Run keeps revisions. The fastest rollback does not involve Terraform:

```bash
gcloud run services update-traffic magpie --region=$REGION \
  --to-revisions=<previous-revision>=100
```

Then fix forward in the repository. Remember Terraform will move traffic back on
the next apply, so treat this as first aid, not a fix.

---

## 16 · What is not proven

Stated plainly so nobody discovers it under pressure.

1. **The pipeline has never run.** There is no GitLab here to run it against. The
   most likely adjustments are the runner images your organisation permits and the
   WIF audience string.
2. **The Shared VPC path has never been applied.** It is written and validated but
   has only ever run against a project with a `default` network.
3. **The custom Vertex role has never served a live transcription.** Section 13,
   step 6.
4. **The penetration test is outstanding.** It was deliberately deferred until a
   real VMO2 environment existed. This is that environment — book it.
5. **`manage_apis = false` degrades error quality.** A missing API surfaces as that
   API's own error at whichever resource needs it, rather than as a clear message
   up front. Not a defect; just know what you are reading.

---

## Appendix A · What the pipeline does

| Stage | Job | Runs on | What it does |
|---|---|---|---|
| verify | `test` | every push | lint, typecheck, 357 unit and integration tests |
| verify | `e2e` | every push | Playwright against a real Postgres service |
| build | `build` | `main` and MRs | Kaniko builds and pushes one image tagged with the commit |
| plan | `plan` | `main` and MRs | `tofu plan`, saved as an artefact; **fails if the plan destroys the database or its networking** |
| deploy | `deploy` | `main`, **manual** | applies the exact plan that was reviewed |

Kaniko rather than docker-in-docker, because dind needs a privileged runner and
most organisations will not give you one.

The eval harness is deliberately absent: it makes real model calls, so on every
push it would spend real money. Run it when you mean to: `npm run eval`.

## Appendix B · Environment variables the application reads

Set by Terraform unless marked otherwise.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | from Secret Manager, private IP |
| `ANTHROPIC_API_KEY` | from Secret Manager — **you set the value** (§11) |
| `ADMIN_PASSWORD` | from Secret Manager — **you set the value** (§11) |
| `SESSION_SECRET` | generated by Terraform; rotating it signs everyone out |
| `MODEL` | model id — configuration, never code (P5) |
| `RETENTION_DAYS` | how long interview content is kept |
| `RETENTION_CALLERS` | identities permitted to run the sweep |
| `TRANSCRIBE_PROVIDER` | `gemini` (Vertex) or `whisper` |
| `TRANSCRIBE_FALLBACK` | off by default: "use Gemini" is not satisfied by silently using OpenAI |
| `ENABLE_TOBE` | analysis views |
| `BASE_URL` | deliberately unset — the app derives its origin from the request, which is what makes invite links work without a redeploy |
