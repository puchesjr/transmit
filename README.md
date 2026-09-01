# Transmit

Phase 6A implementation of a narrow AI-first CRM: a public launch site, customer
records, a shared SMS inbox, missed-call textback, lead tracking, account
billing, human-reviewed AI drafts, and instant website lead capture.

**Query library (frozen):** postgres.js. Do not add Drizzle or Prisma.

## Run locally

Postgres is expected at `postgres://transmit:transmit@127.0.0.1:5432/transmit`.

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
With `ANTHROPIC_API_KEY` unset, Phase 5 uses a deterministic fake AI provider.
Set the key (and optionally `ANTHROPIC_MODEL`) to validate Claude in development.
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

```sh
pnpm check          # svelte-check
pnpm test:unit      # domain + repo tests against transmit_test
pnpm test:e2e       # Playwright: product flows + Axe WCAG A/AA regression checks
```
