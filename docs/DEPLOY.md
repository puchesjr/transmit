# Deploying Kiso CRM

One container, one Postgres. The image serves the app and drains the outbox
in-process, so it needs a host that keeps one instance running all the time:
Cloud Run with a minimum of one instance and CPU always allocated, a Fly
machine, or a plain VM. The local fakes prove the workflow; production refuses
them. With `NODE_ENV=production` the process will not start until every
variable below is set, and it prints the full list of what is missing.

## The image

`Dockerfile` builds with `pnpm build`, prunes to production dependencies, and
runs `docker/entrypoint.sh`, which applies pending migrations and then starts
`node build/index.js` on `PORT` (3000). Set `RUN_MIGRATIONS=false` to run
migrations elsewhere. `/health` answers 200 as soon as the process is up;
`/ready` answers 200 only when Postgres answers.

CI builds the image on every pull request and pushes
`ghcr.io/puchesjr/transmit:main` on every merge to `main`.

## Environment

| Variable | What it is |
|---|---|
| `NODE_ENV` | `production`. Turns on the refusals below. |
| `DATABASE_URL` | Postgres 16. `postgres://user:pass@host:5432/db`; on Cloud SQL, `postgres://user:pass@/db?host=/cloudsql/PROJECT:REGION:INSTANCE`. |
| `PUBLIC_SITE_URL` | `https://kisocrm.com`. Used in emails and links; must be https. |
| `ORIGIN` | Same value. adapter-node needs it behind a proxy; the entrypoint defaults it from `PUBLIC_SITE_URL`. |
| `COOKIE_SECURE` | Leave unset (defaults to true in production). `false` is refused. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Live keys. |
| `STRIPE_LOCATION_PRICE_ID` | The $99 per location monthly price. |
| `STRIPE_MESSAGE_PRICE_ID`, `STRIPE_MESSAGE_METER_EVENT_NAME` | The metered $0.02 message price and its meter event name. |
| `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY` | Live key and the public key that verifies webhooks. |
| `TELNYX_MESSAGING_PROFILE_ID`, `TELNYX_VOICE_CONNECTION_ID` | The messaging profile numbers are bought into, and the voice application. |
| `TRANSMIT_API_KEY`, `EMAIL_FROM` | Password-reset email through transmit.dev. `EMAIL_FROM` must be an approved sender on the verified domain, e.g. `Kiso CRM <hello@kisocrm.com>`. |
| `XAI_API_KEY`, `XAI_ZDR_CONFIRMED=true` | Optional. Grok drafts; the flag is required once the key is set. Or `ANTHROPIC_API_KEY` with `AI_PROVIDER=anthropic`, or `AI_PROVIDER=fake` to run without AI on purpose. |
| `PUBLIC_ANALYTICS_SCRIPT_URL`, `PUBLIC_ANALYTICS_SITE_ID` | Optional, consent-gated. |
| `WORKER_DISABLED` | Leave unset. Set `true` only when a separate worker process runs `scripts/worker.ts`. |

Any `*_PROVIDER=fake` is refused in production.

## Cloud Run, step by step

```sh
PROJECT=your-project REGION=us-central1
gcloud sql instances create kiso-pg --database-version=POSTGRES_16 --tier=db-g1-small --region=$REGION --backup-start-time=08:00 --enable-point-in-time-recovery
gcloud sql databases create kiso --instance=kiso-pg
gcloud sql users create kiso --instance=kiso-pg --password="$(openssl rand -base64 24)"
```

Store every secret in Secret Manager, then deploy from the CI image:

```sh
gcloud run deploy kiso \
  --image ghcr.io/puchesjr/transmit:main \
  --region $REGION --port 3000 \
  --min-instances 1 --max-instances 1 --no-cpu-throttling \
  --add-cloudsql-instances $PROJECT:$REGION:kiso-pg \
  --set-env-vars NODE_ENV=production,PUBLIC_SITE_URL=https://kisocrm.com,ORIGIN=https://kisocrm.com,STRIPE_LOCATION_PRICE_ID=...,STRIPE_MESSAGE_PRICE_ID=...,STRIPE_MESSAGE_METER_EVENT_NAME=...,TELNYX_MESSAGING_PROFILE_ID=...,TELNYX_VOICE_CONNECTION_ID=...,EMAIL_FROM="Kiso CRM <hello@kisocrm.com>" \
  --set-secrets DATABASE_URL=kiso-database-url:latest,STRIPE_SECRET_KEY=kiso-stripe-secret:latest,STRIPE_WEBHOOK_SECRET=kiso-stripe-webhook:latest,TELNYX_API_KEY=kiso-telnyx-key:latest,TELNYX_PUBLIC_KEY=kiso-telnyx-public:latest,TRANSMIT_API_KEY=kiso-transmit-key:latest
```

`--max-instances 1` matters: the outbox drain runs in-process and two
instances would race on it. Map the domain with
`gcloud run domain-mappings create --service kiso --domain kisocrm.com` and
add the DNS records it prints.

Cloud Run pulls from GHCR only if the package is public or a pull secret is
configured; the simpler path is to mirror the image into Artifact Registry in
the same region.

## Fly.io, the shorter path

```sh
fly launch --no-deploy            # picks up the Dockerfile
fly postgres create --name kiso-pg
fly postgres attach kiso-pg       # sets DATABASE_URL
fly secrets set STRIPE_SECRET_KEY=... TELNYX_API_KEY=... TRANSMIT_API_KEY=... # and the rest
fly scale count 1
fly deploy
```

## After the first deploy

1. Point Telnyx webhooks at `https://kisocrm.com/api/v1/webhooks/telnyx` and
   Stripe at `https://kisocrm.com/api/v1/webhooks/stripe`.
2. Sign up with a real card, buy a number, text your own phone, and miss a
   call to it. Then check the Stripe invoice and the Telnyx message log
   against the Inbox. This is the live-provider gate in
   `docs/PRODUCT-HUNT-LAUNCH.md`.
3. Run a restore drill: take a backup, restore it to a scratch instance,
   point a local build at it, sign in. Do this before the first customer, not
   after the first incident.
4. Confirm `/ready` from outside, and that `NODE_ENV=production` refused to
   start when you removed one variable. That refusal is a feature.
