# Transmit — Agent Rules

Read `TRANSMIT-BUILD-PLAN.md` before writing code.
Work **one milestone only**. Do not scaffold later phases.

## Product constraint

Transmit is a narrow AI-first CRM. Do not recreate HubSpot.
Do not add features that are not in the current milestone.

## Stack (locked)

- Svelte 5 + SvelteKit (Node adapter) + TypeScript (pnpm, vitest, playwright)
- Tailwind CSS
- TanStack Query for client server state
- PostgreSQL
- Query library: **postgres.js — frozen in Phase 1.** Do not add Drizzle or Prisma.
- Domain logic in `src/lib/server/**` only
- HTTP in `src/routes/api/v1/**/+server.ts` and pages in `src/routes/(app)/**`
- Async work: worker entry in this codebase, fed by Postgres outbox tables
- SMS/voice provider: **Telnyx**, behind `MessagingProvider`/`VoiceProvider`
  interfaces in `src/lib/server/providers/` (from Phase 2). AI: Anthropic
  Claude behind `AiProvider` (from Phase 5). No vendor SDK outside providers.

Forbidden until the plan says otherwise: Go service, Redis, Kafka, Kubernetes, Elasticsearch, microservices, Pub/Sub, marketing email blasts, public API product.

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
- Provider SDKs (Stripe, Telnyx, OpenAI, etc.) stay behind interfaces.
- Prefer Postgres features over new infrastructure.
- No new dependency without a one-line reason in the milestone report.

## Current milestone (do not exceed)

**Phase 6A — Instant lead capture + integration surface.** Phases 1–2 and 4B
are complete; Phases 3–5 are implemented with live-provider validation still
pending where noted. Scope, exit criteria, and out-of-scope list are defined in
`TRANSMIT-BUILD-PLAN.md` — that file is authoritative. Highlights:

```text
Four focused forms per location
  → durable source, campaign, service, preference, and consent evidence
  → customer + conversation + lead + compliant instant SMS in one transaction
  → deterministic Text us / Request appointment / Get a quote launcher
  → signed outbound webhooks with Postgres-outbox retries
  → consent-safe CSV customer import
```

Out of scope this milestone: conversational website AI, availability lookup,
appointment booking, autonomous promises or sends, a generic form builder,
recording, transcription, softphone, IVR, MMS, campaigns/blasts, public API
product, and custom fields UI.

Non-negotiables for capture: a submission is idempotent and location-scoped;
consent evidence is durable; the immediate reply uses the existing registration,
billing, number, opt-out, and quiet-hour rules; appointment requests do not claim
confirmed availability; webhook secrets are shown once and never logged; all
delivery retries run through the Postgres outbox.

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

- Domain tests for validation, idempotency, durable consent, correct location,
  customer matching, lead/conversation creation, and the compliant instant reply
- Webhook signature verification, event coverage, retry state, and tenant isolation
- CSV parsing, deduplication, row errors, limits, and no inferred SMS consent
- Playwright path: website request → sent SMS → Inbox → lead
- Axe WCAG 2.2 A/AA and responsive checks for public and authenticated capture UI
- Existing CRM, SMS, voice, billing, AI, webhook, accessibility, and launch suites
  remain green
- `sv check` / `svelte-check` and production build clean

## Security minimum

- Parameterized SQL only
- Session cookies, httpOnly, secure in prod
- No secrets in logs
- Request ID on every request
- Health + ready endpoints
