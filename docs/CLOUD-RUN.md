# Cloud Run

Kiso is a long-lived Node process (`adapter-node`) with an in-process
Postgres outbox worker. Deploy it as **one Cloud Run service** that is not
allowed to sleep.

Do not use Cloud Functions, GKE, Firestore, or scale-to-zero Cloud Run.

## Google Business Profile API vs where the app runs

GBP API **approval is attached to a Google Cloud project**, specifically to
OAuth clients created in that project. It is **not** attached to Cloud Run.

| Setup | Works? |
|---|---|
| Cloud Run + Cloud SQL + GBP OAuth client in the **approved** project | Yes. Simplest if IAM isolation is acceptable. |
| Cloud Run in project B, OAuth client + enabled GBP APIs in **approved** project A | Yes. Put `client_id` / `client_secret` in Cloud Run secrets. API calls use the contractor’s OAuth tokens issued to A’s client. |
| Cloud Run service account in B calling GBP with ADC / a key from B | **No.** B was not approved. Quota looks like zero (`RESOURCE_EXHAUSTED`). |
| New OAuth client in an unapproved project | **No.** Do not re-request access unless you intend to abandon the approved project. |

Keep the approved project as the **GBP credential home**. Hosting Kiso in a
different project is fine. Do not create OAuth or a Reviews feature until that
milestone; this only records where the key must live.

If Kiso shares a project with another app: use a **separate Cloud Run service
name**, a **separate Cloud SQL instance or database**, and Secret Manager names
prefixed `kiso-`. Do not reuse the other app’s `DATABASE_URL`.

## Required Cloud Run settings

These are not optional. Without them the webhook returns 200 and Call Control /
SMS never run.

- `--min-instances 1`
- `--no-cpu-throttling` (instance-based billing; CPU allocated between requests)
- `--cpu 1` `--memory 512Mi` (floor for instance-based billing; sub-1 vCPU
  is only allowed with request-based billing, which freezes the worker)
- `--timeout 300`
- `--max-instances 1` until there is real paid load
- `--allow-unauthenticated` (Telnyx, Stripe, public capture; app auth is cookies)
- `--add-cloudsql-instances PROJECT:REGION:INSTANCE`
- `--set-env-vars NODE_ENV=production,COOKIE_SECURE=true,ORIGIN=https://YOUR_URL`

Cloud Run sets `PORT`. Do not override it.

Unix-socket `DATABASE_URL` (Cloud SQL Auth Proxy mount). Empty host is required;
encode `@`, `$`, `#`, `%` in the password (`@` → `%40`, `$` → `%24`):

```text
postgres://USER:PASSWORD@/kiso?host=/cloudsql/PROJECT:REGION:INSTANCE
```

The app maps that string to postgres.js `path` `/cloudsql/…/.s.PGSQL.5432`. Do not put
the password in chat or shell history if you can avoid it (`gcloud secrets versions add`
from a file).

`/ready` pings Postgres. `/health` does not.

## First-time GCP setup

Replace placeholders. Use the project that should **host** Kiso (same as GBP
or not).

```sh
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com

gcloud artifacts repositories create kiso \
  --repository-format=docker \
  --location=us-central1

gcloud artifacts repositories set-cleanup-policies kiso \
  --location=us-central1 \
  --policy=artifact-registry-cleanup.json \
  --no-dry-run

gcloud sql instances create kiso-pg \
  --database-version=POSTGRES_16 \
  --edition=enterprise \
  --tier=db-f1-micro \
  --region=us-central1 \
  --storage-size=10GB \
  --availability-type=zonal

gcloud sql databases create kiso --instance=kiso-pg
gcloud sql users create kiso --instance=kiso-pg --password=GENERATE_A_SECRET
```

Store secrets in Secret Manager (`DATABASE_URL`, Telnyx, Stripe, xAI). Grant
the Cloud Run runtime service account `roles/cloudsql.client` and
`roles/secretmanager.secretAccessor`.

Migrate **before** sending traffic, as a one-off job using this image, not on
container start:

```sh
gcloud run jobs deploy kiso-migrate \
  --image IMAGE \
  --region us-central1 \
  --set-cloudsql-instances PROJECT:us-central1:kiso-pg \
  --set-secrets DATABASE_URL=kiso-database-url:latest \
  --command ./node_modules/.bin/tsx --args scripts/migrate.ts \
  --execute-now
```

## CI and deploy (no full rebuild every time)

**GitHub Actions** (`.github/workflows/ci.yml`) runs on PRs and `main` only when
app code changes. Docs-only commits are skipped. Jobs are split:

| Change | What runs |
|---|---|
| `src/lib/server/**`, `tests/**`, migrations | Vitest. PRs use `--changed` vs the base branch; `main` runs the full unit suite |
| `src/**` | `pnpm check` |
| Routes, client, `e2e/**`, Playwright config | Playwright **Chromium only** (not the full browser matrix) |
| `docs/**`, markdown | Nothing |

Deploy is **Cloud Build**, not GitHub. The pipeline builds a cached Docker
image, runs migrations, then deploys Cloud Run. It does **not** run unit tests,
`svelte-check`, or Playwright.

Connect the GitHub repo in Cloud Build (2nd gen repository), trigger on `main`,
config `cloudbuild.yaml`. Ignored files so a README edit does not rebuild:

```text
docs/**
**/*.md
.github/**
AGENTS.md
KISO-BUILD-PLAN.md
e2e/**
tests/**
```

Grant the Cloud Build service account (`PROJECT_NUMBER@cloudbuild.gserviceaccount.com`):

- Artifact Registry Writer
- Cloud Run Admin
- Cloud SQL Client
- Service Account User (the Cloud Run runtime SA)
- Secret Manager Secret Accessor

Create the Artifact Registry repo and Secret Manager secrets **once** (see
above) before the first trigger. Bootstrap secrets with placeholder values if
Telnyx/Stripe are not live yet — deploy still requires the secret **names** to
exist.

Manual deploy of the same pipeline:

```sh
gcloud builds submit --config cloudbuild.yaml
```

## Manual `gcloud run deploy`

From the repo root, after secrets exist:

```sh
gcloud run deploy kiso \
  --source . \
  --region us-central1 \
  --min-instances 1 \
  --max-instances 1 \
  --no-cpu-throttling \
  --cpu 1 \
  --memory 512Mi \
  --timeout 300 \
  --allow-unauthenticated \
  --add-cloudsql-instances PROJECT:us-central1:kiso-pg \
  --set-env-vars NODE_ENV=production,COOKIE_SECURE=true,ORIGIN=https://REPLACE.run.app,PUBLIC_SITE_URL=https://kisocrm.com,SCHEDULER_PROVIDER=fake,XAI_REQUIRE_ZDR=true \
  --set-secrets DATABASE_URL=kiso-database-url:latest,TELNYX_API_KEY=kiso-telnyx-api-key:latest,TELNYX_PUBLIC_KEY=kiso-telnyx-public-key:latest,TELNYX_MESSAGING_PROFILE_ID=kiso-telnyx-messaging-profile:latest,TELNYX_VOICE_CONNECTION_ID=kiso-telnyx-voice-connection:latest,STRIPE_SECRET_KEY=kiso-stripe-secret:latest,STRIPE_WEBHOOK_SECRET=kiso-stripe-webhook:latest,STRIPE_LOCATION_PRICE_ID=kiso-stripe-location-price:latest,STRIPE_MESSAGE_PRICE_ID=kiso-stripe-message-price:latest,STRIPE_MESSAGE_METER_EVENT_NAME=kiso-stripe-meter-name:latest
```

`kiso-stripe-message-price` is a **per-unit** metered Price of **$0.02**
(`unit_amount=2`) on meter `kiso_message`. Do not use Graduated first-250-free;
Kiso reports only overage credits. `kiso-stripe-meter-name` is the event name
`kiso_message`.

Then set `ORIGIN` (and Stripe/Telnyx webhook URLs) to the printed `*.run.app`
URL or the custom domain. Map `kisocrm.com` in Cloud Run domain mappings when
DNS is ready.

Leave `XAI_ZDR_CONFIRMED` unset or `false` until Zero Data Retention is on in
the xAI console. Leave scheduler fake; production refuses it and the concierge
says scheduling is not ready.

## Smallest sizes (until you have paying customers)

| Resource | Size | Why not smaller |
|---|---|---|
| Cloud SQL | `db-f1-micro`, zonal, 10 GB SSD | Shared-core floor. No SLA. ~$8–12/mo with disk. |
| Cloud Run | 1 vCPU, 512Mi, min=1, max=1 | Instance-based billing (needed for the outbox) requires ≥1 vCPU and ≥512Mi. |
| Migrate job | 1 vCPU, 512Mi, runs then exits | Same floor; billed only while migrating. |

Do not drop Cloud Run below 1 vCPU. That forces request-based billing and the missed-call worker stops between webhooks.

## Artifact and revision cleanup

Keep the last **10** container versions and Cloud Run revisions.

Artifact Registry: `artifact-registry-cleanup.json` keeps the 10 newest images and deletes older tagged/untagged digests after 1 day (so an in-flight deploy is not removed). Apply once after creating the repo (command above). Policies take effect within about a day.

Cloud Build: each deploy deletes Cloud Run revisions beyond the newest 10 (`gcloud run revisions delete`). Serving revisions are skipped if delete fails. Old revisions that are not serving do not incur min-instance charges; this is to cap clutter, not CPU.

Cloud Build logs use `CLOUD_LOGGING_ONLY` (no extra GCS tarball of the image). Cloud Logging retention is a project-level sink setting; 30 days is enough.

## What this does not include

No GBP OAuth in the app, no review tables, no Terraform, no GKE. After deploy,
prove the live punch list in `docs/PRODUCT-HUNT-LAUNCH.md`.
