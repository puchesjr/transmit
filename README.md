# Kiso CRM

Phase 6B implementation of a narrow AI-first CRM: a public launch site, customer
records, a shared SMS inbox, missed-call textback, lead tracking, account
billing, human-reviewed AI drafts, instant website lead capture, and a guarded
AI website concierge that books real scheduler availability.

**Query library (frozen):** postgres.js. Do not add Drizzle or Prisma.

## Run locally

Postgres is expected at `postgres://transmit:transmit@127.0.0.1:5432/transmit`.
The local database keeps this legacy identifier so existing development volumes
continue to work; it is unrelated to the separate `transmit.dev` email product.

```sh
docker compose up -d          # if Docker is available
# or use a local Postgres 16+ with user/password transmit and databases
# `transmit`, `transmit_test`, and `transmit_e2e`

pnpm install
pnpm migrate
pnpm dev
```

Production Node adapter: `pnpm build && pnpm start`. That process loads `.env` if present; also set `ORIGIN` to the public URL. Live Stripe, Telnyx, and xAI gates are in [`docs/PRODUCT-HUNT-LAUNCH.md`](docs/PRODUCT-HUNT-LAUNCH.md). Google Cloud Run (always-on CPU, Cloud SQL Postgres, Cloud Build deploy) is documented in [`docs/CLOUD-RUN.md`](docs/CLOUD-RUN.md).

Sign up at `/signup`. That creates the workspace, default location, and Sales
pipeline, then sends you into `/onboarding` to start the 14-day trial, register
for SMS, pick a number, and set missed-call forwarding. With Stripe keys unset,
local development uses the demo billing provider so the full trial flow can be
exercised without a charge. Existing workspaces can skip setup and finish later.
The public marketing site is available at `/`, with privacy, terms, sitemap, and
consent-gated analytics configured through the public environment variables.
With both AI keys unset, Phase 5 uses a deterministic fake AI provider. Set
`XAI_API_KEY` to use Grok 4.6 with low reasoning, or select Anthropic explicitly
with `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. Production xAI traffic is
blocked until `XAI_ZDR_CONFIRMED=true`; enable Zero Data Retention in the xAI
console before setting that flag.

Run `pnpm eval:ai` with both keys to compare Grok and Claude against synthetic
Kiso CRM conversations without logging customer messages.
AI never sends SMS automatically; every generated SMS draft must be selected and
sent through the normal composer. In the booking concierge, AI can qualify the
visitor and explain server-provided choices, but only deterministic scheduler
tools may offer, hold, book, or cancel an appointment.

Lead capture lives under Settings → Lead capture. Each location receives four
focused hosted forms plus an install-once website launcher for Text us, Request
appointment, and Get a quote. A valid submission records attribution and consent,
creates the customer/conversation/lead transactionally, and queues the immediate
SMS through the same billing, registration, number, opt-out, and quiet-hour rules
as every other send. The appointment launcher now opens the Phase 6B concierge.
Enable it and map location-specific services under Settings → Booking. Local
development and tests use the fake scheduler; production refuses to start that
provider. The design-partner HTTP contract is documented in
[`docs/BOOKING-SCHEDULER.md`](docs/BOOKING-SCHEDULER.md).

Outbound integrations support signed `contact.created`, `message.received`, and
`opportunity.stage_changed` events with Postgres-outbox retries. See
[`docs/WEBHOOKS.md`](docs/WEBHOOKS.md) for the wire contract and verification
example. CSV imports accept up to 500 customers at a time and never infer SMS
consent from uploaded data.

```sh
pnpm check          # svelte-check
pnpm test:unit      # domain + repo tests against transmit_test
pnpm test:e2e       # Playwright: product flows + Axe WCAG A/AA regression checks
```

Browser tests use a dedicated `_e2e` database and a fresh fake-provider server. For an existing Docker volume, create it once with `docker compose exec postgres createdb -U transmit transmit_e2e`. Set `E2E_DATABASE_URL` for a different dedicated test database. Never share its outbox with a live-provider worker. Telecom pricing, migrations, and reconciliation gates are documented in [`docs/TELECOM-COGS.md`](docs/TELECOM-COGS.md).
