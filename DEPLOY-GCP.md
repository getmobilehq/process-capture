# Magpie on GCP — deployment plan

Region **europe-west2 (London)** throughout: interview data should not leave the UK,
and co-locating Cloud Run with Cloud SQL keeps the database hop off the public
internet.

## Shape

| Component | Service | Why |
|---|---|---|
| App | **Cloud Run** | The `Dockerfile` works as-is. One deployable, per P6. |
| Database | **Cloud SQL for PostgreSQL 16** | Private IP inside the VPC. `db-g1-small`, Enterprise edition. |
| Secrets | **Secret Manager** | `ANTHROPIC_API_KEY`, `ADMIN_PASSWORD`, `DATABASE_URL`. |
| Images | **Artifact Registry** | |
| CI | **GitHub Actions** | Unit tests and evals run on pglite — no database service needed. Playwright needs a Postgres container. |

Not chosen: AlloyDB (overkill at pilot scale), GKE (breaks "one deployable"),
Firestore (the schema is relational and the joins are real).

**The database is on a private IP.** Most organisations enforce
`constraints/sql.restrictPublicIp`, and it is the correct posture for named
employees' accounts of their own work. That adds the one-time peering in step 3;
everything downstream follows from it — no unix socket, no Auth Proxy, and Cloud Run
needs Direct VPC egress.


## 1.  Before you start

You need the gcloud CLI installed and signed in, a Google Cloud project with billing enabled, your Anthropic API key, and a password you choose for the console.

Set these once. Every later command uses them, and a new Cloud Shell session loses them — if a command fails oddly, check these are still set.

```bash
export PROJECT=$(gcloud config get-value project)
export REGION=europe-west2
echo "project=$PROJECT region=$REGION"
```


## 2.  Turn on the services

```bash
gcloud services enable \
  run.googleapis.com sqladmin.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com compute.googleapis.com \
  servicenetworking.googleapis.com
```


## 3.  Let your network reach Google-managed databases

One time per project. The database will sit on a private IP inside your VPC, which needs this peering to exist first. Without it, creating the instance fails with a network error.

```bash
gcloud compute addresses create google-managed-services-default \
  --global --purpose=VPC_PEERING --prefix-length=16 --network=default

gcloud services vpc-peerings connect \
  --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services-default --network=default
```


*Check:* `gcloud services vpc-peerings list --network=default   →   one servicenetworking entry`


> **Already exists?** — If it reports an existing connection, that is fine — carry on.


## 4.  Create the database

Takes 5–10 minutes. Start it, then read step 5 while it builds.

```bash
gcloud sql instances create magpie-db \
  --database-version=POSTGRES_16 \
  --edition=ENTERPRISE \
  --tier=db-g1-small \
  --region=$REGION \
  --network=projects/$PROJECT/global/networks/default \
  --no-assign-ip \
  --backup-start-time=02:00 --retained-backups-count=7

gcloud sql databases create magpie --instance=magpie-db

export DB_PASS=$(openssl rand -base64 24)
gcloud sql users create magpie --instance=magpie-db --password="$DB_PASS"
```


> **Two flags do the heavy lifting** — --edition=ENTERPRISE, because Cloud SQL now defaults to Enterprise Plus and that edition rejects small tiers. And --no-assign-ip with --network, because most organisations block public-IP databases — which is correct for interview data. If you hit “Invalid Tier”, it is the edition; if you hit “violates constraints/sql.restrictPublicIp”, it is the network flags.


*Check:* `gcloud sql instances describe magpie-db --format="value(ipAddresses[0].ipAddress)"   →   a 10.x.x.x address`


## 5.  Store the secrets

Nothing sensitive goes into the container image or into a command you type in full.

```bash
export DB_IP=$(gcloud sql instances describe magpie-db \
  --format="value(ipAddresses[0].ipAddress)")

for s in anthropic-api-key admin-password database-url; do
  gcloud secrets create $s --replication-policy=automatic
done

# Paste the value, then press Ctrl-D.
gcloud secrets versions add anthropic-api-key --data-file=-
gcloud secrets versions add admin-password   --data-file=-

printf "postgres://magpie:$DB_PASS@$DB_IP:5432/magpie" \
  | gcloud secrets versions add database-url --data-file=-
```


> **Do not add an OpenAI key** — Voice input sends the interviewee’s audio to a third party. Leave OPENAI_API_KEY unset and the microphone button does not appear at all. Enable it only once the privacy notice has been re-approved.


## 6.  Build and deploy

```bash
export REPO=$REGION-docker.pkg.dev/$PROJECT/magpie
gcloud artifacts repositories create magpie \
  --repository-format=docker --location=$REGION

export TAG=$REPO/app:v1
gcloud builds submit --tag $TAG

gcloud run deploy magpie \
  --image=$TAG --region=$REGION --allow-unauthenticated \
  --network=default --subnet=default \
  --vpc-egress=private-ranges-only \
  --set-secrets=ANTHROPIC_API_KEY=anthropic-api-key:latest,\
ADMIN_PASSWORD=admin-password:latest,DATABASE_URL=database-url:latest \
  --set-env-vars=MODEL=claude-sonnet-4-6,NODE_ENV=production \
  --min-instances=1 --max-instances=1 \
  --timeout=600 --memory=1Gi --cpu=1
```


> **The tables create themselves** — The container runs its migration before starting the server, and refuses to start if that fails. So there is no separate migration step — if the service comes up, the database is ready. If it will not start, read the logs: a migration failure says so explicitly.


## 7.  Why those flags matter

- **--network / --subnet / --vpc-egress  —** without these the container has no route into your VPC and every database query times out.
- **--timeout=600  —** drawing a process map makes two model calls in one request and exceeds the 300-second default.
- **--max-instances=1  —** correctness, not capacity. Rate limits are held per instance, so a second instance silently doubles every limit. Do not raise it without moving that state to the database.
- **--min-instances=1  —** no cold start in front of a waiting interviewee.


## 8.  Set the base URL, then redeploy

Cloud Run only issues the service URL after the first deploy, and invite links are built from it. Skip this and the links you send will point at localhost.

```bash
export URL=$(gcloud run services describe magpie \
  --region=$REGION --format="value(status.url)")

gcloud run services update magpie --region=$REGION \
  --update-env-vars=BASE_URL=$URL

echo $URL
```


## 9.  Prepare the demo

Open the service URL, sign in to the console with your admin password, then:

- Create a campaign, add an interviewee, copy their invite link.
- Run the interview through to the end — about 20–30 minutes of real conversation.
- Open the specification from the register, then the Process map tab.


> **Warm the map before an audience sees it** — The first time a process map is drawn it costs a model call and takes a moment. It is then stored and redraws instantly. Open it once beforehand.


## 10.  What is switched off, and why

- **The To-be map  —** Magpie can propose improvements from the bottlenecks it finds, but a person must approve each one before it can reach a report, and that review screen is not built yet. If asked: nothing machine-generated reaches a report unreviewed. That is a design decision, not a missing feature.
- **Voice input  —** audio would leave for a third party. Unset by default.


**One thing to be straight about if it comes up**

The privacy notice tells interviewees their data is kept for a set period. Automatic deletion after that period is not built, and daily backups hold a week of data regardless. Fine for a demo with invented content. It needs solving before real interviewees are pointed at it.


## 11.  If something goes wrong

- **The service will not start  —** gcloud run services logs read magpie --region=$REGION --limit=50. A migration failure names itself.
- **Queries hang, then time out  —** the VPC egress flags were not applied. Check with gcloud run services describe magpie.
- **“Invalid Tier”  —** add --edition=ENTERPRISE.
- **“violates constraints/sql.restrictPublicIp”  —** add --no-assign-ip and --network. Do not disable the policy; it is protecting interview data.
- **Invite links point at localhost  —** step 8 was skipped.
- **Cannot sign in  —** the ADMIN_PASSWORD secret and what you are typing differ. Add a new secret version and redeploy.


## Running cost

About £35–40 per month for the database and one always-on instance, plus Anthropic usage. A full interview is roughly 500,000 input tokens across its turns — model usage will dominate the bill, not the infrastructure.
