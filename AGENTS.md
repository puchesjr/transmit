## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm
- **Add-ons**: vitest, playwright, tailwindcss, sveltekit-adapter

---

# Transmit — Agent Rules

Read `TRANSMIT-BUILD-PLAN.md` before writing code.
Work **one milestone only**. Do not scaffold later phases.

## Product constraint

Transmit is a narrow AI-first CRM. Do not recreate HubSpot.
Do not add features that are not in the current milestone.

## Stack (locked)

- Svelte 5 + SvelteKit (Node adapter) + TypeScript
- Tailwind CSS
- TanStack Query for client server state
- PostgreSQL
- One query library: Drizzle **or** postgres.js — pick in Phase 1 and freeze it
- Domain logic in `src/lib/server/**` only
- HTTP in `src/routes/api/v1/**/+server.ts` and pages in `src/routes/(app)/**`
- Cloud Tasks worker is the same codebase, separate entry, later

Forbidden until the plan says otherwise: Go service, Redis, Kafka, Kubernetes, Elasticsearch, microservices, Pub/Sub, marketing email, voice, public API product.

## Svelte 5 — runes only

Always:

```svelte
<script lang="ts">
  let count = $state(0);
  let doubled = $derived(count * 2);
  const { title }: { title: string } = $props();
</script>

<button onclick={() => count++}>{title}: {count}</button>
```

Never:

- `$: `
- `export let`
- `on:click` / `on:submit` (use `onclick` / `onsubmit`)
- writable/readable stores as default component state
- React / JSX / hooks
- fetching inside `$effect` (use TanStack Query)

If you generate Svelte 4 syntax, delete it and rewrite.

## Architecture

- Multi-tenant from day one. Every customer row has `account_id`.
- Locations are first-class (`locations` table). Contacts/opportunities carry `account_id` and `location_id`.
- Every SELECT/UPDATE/DELETE is scoped by `account_id`. Never trust the client to filter tenants.
- Application-generated UUIDv7 (or ULID) IDs.
- Thin route handlers: parse → authz → domain function → map error.
- No business rules in `+page.server.ts` or `+server.ts`.
- Provider SDKs (Twilio, OpenAI, etc.) stay behind interfaces. None in this milestone.
- Prefer Postgres features over new infrastructure.
- No new dependency without a one-line reason in the milestone report.

## Current milestone (do not exceed)

**Phase 1 vertical slice only:**

```text
signup / sign-in
  → create account (workspace)
  → default location
  → create contact
  → create company (optional associate)
  → create opportunity on a default pipeline
  → move opportunity stage
  → contact activity timeline shows those events
```

Out of scope: forms, SMS, email, voice, AI, workflows, billing, embeds, webhooks product, custom fields UI.

## Before you code

Output:

1. Proposed files
2. Schema / migrations
3. Routes
4. UI pages
5. Tests
6. Risks

Wait for approval if running in plan mode. Then implement.

## After you code

Report:

```text
Completed
Tests added / passing
Migrations
Svelte 4 syntax found? (must be none)
Queries without account_id? (must be none)
Remaining issues
Next milestone (do not start it)
```

## Tests required this milestone

- Domain tests for account + contact create
- Repository tests against real Postgres
- At least one Playwright (or equivalent) path: sign in → create contact → see it listed
- `sv check` / `svelte-check` clean

## Security minimum

- Parameterized SQL only
- Session cookies, httpOnly, secure in prod
- No secrets in logs
- Request ID on every request
- Health + ready endpoints
