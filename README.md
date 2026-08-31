# Transmit

Phase 1 vertical slice of a narrow AI-first CRM.

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

Sign up at `/signup`. That creates the workspace, default location, and Sales pipeline.

```sh
pnpm check          # svelte-check
pnpm test:unit      # domain + repo tests against transmit_test
pnpm test:e2e       # Playwright: signup → create contact → see it
```
