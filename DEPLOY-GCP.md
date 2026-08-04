# Magpie on GCP — deployment plan

Written against the state of `migrate/postgres` (Postgres migration complete, all
gates green). Region is **europe-west2 (London)** throughout: VMO2 informant data
should not leave the UK, and putting Cloud Run and Cloud SQL in the same region
also keeps the database hop off the public internet.

## Shape

| Component | Service | Why |
|---|---|---|
| App | **Cloud Run** | The `Dockerfile` already works. One deployable, per P6. Scales to zero between interviews. |
| Database | **Cloud SQL for PostgreSQL 16** | Private IP only. `db-g1-small` is ample for a pilot. |
| Secrets | **Secret Manager** | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ADMIN_PASSWORD`. Nothing in the image. |
| Images | **Artifact Registry** | |
| CI | **GitHub Actions** | Tests and evals run on pglite, so CI needs **no database service**. |

Not chosen, deliberately: AlloyDB (overkill at pilot scale), GKE (breaks "one
deployable"), Firestore (the schema is relational and the joins are real).

## Pre-flight — must be true before the first deploy

1. **Merge `migrate/postgres`.** SQLite cannot survive Cloud Run's ephemeral
   filesystem; the database file goes with the container on every cold start.
   Blockers on that branch: Playwright still points at `file:./data/e2e.db`, and
   `better-sqlite3` + `data/*.db` want removing once it does.
2. **Decide the rate-limit question.** `lib/rate-limit.ts` is an in-memory Map, so
   with N instances the limit becomes N × the intended value. Either pin
   `--max-instances=1` for the pilot (fine — interviews are not concurrent at this
   scale, and it removes cold starts too) or move the buckets into a table. Pinning
   is the honest pilot answer; the table is the answer before wider rollout.
3. **Set `SESSION_MAX_TURNS` and `QUESTION_BUDGET` for the pilot**, and confirm
   `MODEL`. All are env, per P5 — no redeploy of code to change them.

## Provisioning

```bash
PROJECT=magpie-pilot; REGION=europe-west2
gcloud config set project $PROJECT

gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com

# Database — private IP, no public endpoint.
gcloud sql instances create magpie-db \
  --database-version=POSTGRES_16 --tier=db-g1-small --region=$REGION \
  --no-assign-ip --network=default \
  --backup-start-time=02:00 --retained-backups-count=7 \
  --database-flags=cloudsql.iam_authentication=on
gcloud sql databases create magpie --instance=magpie-db
gcloud sql users create magpie --instance=magpie-db --password="$(openssl rand -base64 24)"

# Secrets — created empty, then piped in so keys never reach shell history.
for s in anthropic-api-key openai-api-key admin-password database-url; do
  gcloud secrets create $s --replication-policy=user-managed --locations=$REGION
done
# printf '%s' "$KEY" | gcloud secrets versions add anthropic-api-key --data-file=-
```

`DATABASE_URL` takes the form
`postgres://magpie:PASSWORD@/magpie?host=/cloudsql/PROJECT:REGION:magpie-db`
— the unix socket the Cloud SQL connector mounts, not a TCP host.

## Deploy

```bash
gcloud builds submit --tag $REGION-docker.pkg.dev/$PROJECT/magpie/app:$(git rev-parse --short HEAD)

gcloud run deploy magpie \
  --image=$REGION-docker.pkg.dev/$PROJECT/magpie/app:$(git rev-parse --short HEAD) \
  --region=$REGION --platform=managed --no-allow-unauthenticated \
  --add-cloudsql-instances=$PROJECT:$REGION:magpie-db \
  --set-secrets=ANTHROPIC_API_KEY=anthropic-api-key:latest,\
OPENAI_API_KEY=openai-api-key:latest,\
ADMIN_PASSWORD=admin-password:latest,\
DATABASE_URL=database-url:latest \
  --set-env-vars=MODEL=claude-sonnet-4-6,NODE_ENV=production,BASE_URL=https://magpie.example \
  --min-instances=1 --max-instances=1 \
  --timeout=600 --memory=1Gi --cpu=1
```

Then `npm run db:migrate` once against the instance (Cloud SQL Auth Proxy from a
workstation, or a one-shot Cloud Run Job).

**Why these flags:**
- `--timeout=600` — graph extraction is two live model calls in one request and can
  run past the 300s default. Interview turns are 10–30s; extraction is the outlier.
- `--min-instances=1` — no cold start in front of a waiting informant, and it makes
  the in-memory rate limiter correct. A few pounds a month.
- `--max-instances=1` — see the rate-limit note. Lift it when the buckets move.
- `--no-allow-unauthenticated` — then put the interview routes behind a load
  balancer, or flip to public once you are satisfied the console gate is enough.
  **Note the asymmetry: `/i/{token}` must be publicly reachable for informants,
  while `/console` must not be.** Tokenised links are the only thing protecting
  interview URLs, which is by design (FR-2.1) but worth stating out loud.

## What I would hold back from the pilot

- **The To-be tab.** R5.4's verification gate is not built: machine-generated
  process recommendations are reachable with nothing preventing them reaching a
  handover report, and the delta locks that decision. A local dev server makes that
  theoretical; a deployed URL an architect can reach makes it real. Either finish
  the gate or hide the tab behind an env flag before this is shared.
- **Voice input**, unless the privacy notice has been re-approved. `OPENAI_API_KEY`
  set means informant audio goes to a third party (DV.1). Leave it unset and the
  mic button does not render.

## Data protection — decide before real informants

- **`RETENTION_DAYS` is surfaced in the privacy notice but not enforced** (V1.1
  item). Once real data sits in a managed database with automated backups, "we
  delete after 365 days" must actually be true *including in the backups* —
  `--retained-backups-count=7` means a week of daily snapshots holding whatever was
  live. A deletion job that ignores backups is a promise you are not keeping.
- **Emails live only in the register, never in specs (P7).** That holds in the
  schema; worth re-checking against the deployed download paths.
- Cloud Logging captures request logs. Set a retention period and confirm no
  informant content reaches them — P7 says statements only, no telemetry.

## CI

Tests and evals run on pglite, so the pipeline needs no database service:

```yaml
- run: npm ci
- run: npm run lint && npm run typecheck && npm test && npm run build
```

Playwright will want a Postgres once it is migrated off the SQLite file — or pglite
again, which keeps the pipeline dependency-free. The live eval should stay
**manual**: it costs real money per run and should be a deliberate act before a
release, not something a push triggers.

## Rough monthly cost

Cloud SQL `db-g1-small` ~£25, Cloud Run at min-instances=1 ~£10, Artifact Registry
and Secret Manager pennies. Call it **£35–40/month** plus model usage — which will
dominate: one interview is roughly 500k input tokens across its turns.
