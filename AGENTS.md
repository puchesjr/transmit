# Kiso CRM — Agent Rules

Read `KISO-BUILD-PLAN.md` before writing code.
Work **one milestone only**. Do not scaffold later phases.

## Product constraint

Kiso CRM is a narrow AI-first CRM. Do not recreate HubSpot.
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
  interfaces in `src/lib/server/providers/` (from Phase 2). AI: xAI Grok 4.6
  primary with Anthropic Claude selectable behind `AiProvider` (from Phase 5).
  No vendor SDK outside providers.

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

**Phase 6B — Conversational booking.** Phase 6A is implemented locally; prior
live-provider validation remains pending where noted. Scope, exit criteria, and
out-of-scope list are defined in `KISO-BUILD-PLAN.md` — that file is
authoritative. Highlights:

```text
Appointment launcher per location
  → durable consent + customer + conversation + lead
  → audited AI qualification with deterministic tool boundaries
  → real scheduler availability → hold → book or cancel
  → explicit handoff, human takeover, and timeout in Inbox
  → compliant confirmation SMS through existing enforcement
```

Out of scope this milestone: a generic form or chatbot builder, autonomous
promises, invented availability, dispatch, replacing a field-service scheduler,
recording, transcription, softphone, IVR, MMS, campaigns/blasts, public API
product, and custom fields UI.

Non-negotiables for booking: a session is capability-protected, idempotent, and
location-scoped; AI never invents availability or executes scheduler actions;
held and booked slots must exactly match an offered provider slot; uncertainty
routes to a human; confirmation SMS uses the existing registration, billing,
number, opt-out, and quiet-hour rules; retries run through the Postgres outbox.

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

- Domain tests for qualification, idempotency, durable consent, location/service
  routing, scheduler availability/hold/book/cancel, timeout, and human handoff
- Provider contract tests for slot integrity, idempotency, authentication, and
  production refusal of the fake scheduler
- Tenant isolation for settings, services, sessions, and appointments
- Playwright path: website concierge → real slot → booking → SMS → Inbox → lead
- Axe WCAG 2.2 A/AA and responsive checks for public and authenticated booking UI
- Existing CRM, SMS, voice, billing, AI, webhook, accessibility, and launch suites
  remain green
- `sv check` / `svelte-check` and production build clean

## Security minimum

- Parameterized SQL only
- Session cookies, httpOnly, secure in prod
- No secrets in logs
- Request ID on every request
- Health + ready endpoints
