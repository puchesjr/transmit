# Kiso CRM

Phase 6A implementation of a narrow AI-first CRM: a public launch site, customer
records, a shared SMS inbox, missed-call textback, lead tracking, account
billing, human-reviewed AI drafts, and instant website lead capture.

**Query library (frozen):** postgres.js. Do not add Drizzle or Prisma.

## Run locally

Postgres is expected at `postgres://transmit:transmit@127.0.0.1:5432/transmit`.
The local database keeps this legacy identifier so existing development volumes
continue to work; it is unrelated to the separate `transmit.dev` email product.

```sh
docker compose up -d          # if Docker is available
# or use a local Postgres 16+ with user/password transmit and databases
# `transmit` and `transmit_test`

pnpm install
pnpm migrate
pnpm dev
```

Sign up at `/signup`. That creates the workspace, default location, Sales pipeline,
and unconfigured billing account. With Stripe keys unset, local development uses
the demo billing provider so the full trial flow can be exercised without a charge.
The public marketing site is available at `/`, with privacy, terms, sitemap, and
consent-gated analytics configured through the public environment variables.
With both AI keys unset, Phase 5 uses a deterministic fake AI provider. Set
`XAI_API_KEY` to use Grok 4.6 with low reasoning, or select Anthropic explicitly
with `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. Production xAI traffic is
blocked until `XAI_ZDR_CONFIRMED=true`; enable Zero Data Retention in the xAI
console before setting that flag.

Run `pnpm eval:ai` with both keys to compare Grok and Claude against synthetic
Kiso CRM conversations without logging customer messages.
AI never sends automatically; every generated draft must be selected and sent
through the normal SMS composer.

Lead capture lives under Settings → Lead capture. Each location receives four
focused hosted forms plus an install-once website launcher for Text us, Request
appointment, and Get a quote. A valid submission records attribution and consent,
creates the customer/conversation/lead transactionally, and queues the immediate
SMS through the same billing, registration, number, opt-out, and quiet-hour rules
as every other send. The appointment flow captures a preference for human
confirmation; it does not claim to book a real time.

Outbound integrations support signed `contact.created`, `message.received`, and
`opportunity.stage_changed` events with Postgres-outbox retries. See
[`docs/WEBHOOKS.md`](docs/WEBHOOKS.md) for the wire contract and verification
example. CSV imports accept up to 500 customers at a time and never infer SMS
consent from uploaded data.

Password resets go out through transmit.dev (`TRANSMIT_API_KEY`, `EMAIL_FROM`).
Locally the fake email provider keeps messages in memory and logs the recipient
and subject.

## Deploy

`docs/DEPLOY.md` covers the container, the environment, Cloud Run and Fly
recipes, and the live-provider checks to run after the first deploy. In
production the process refuses to start with any provider on a fake or any
required variable missing, and prints the full list of what it wants.

```sh
pnpm check          # svelte-check
pnpm test:unit      # domain + repo tests against transmit_test
pnpm test:e2e       # Playwright: product flows + Axe WCAG A/AA regression checks
```
