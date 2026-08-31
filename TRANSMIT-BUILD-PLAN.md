# Transmit — Build Plan

Read together with `AGENTS.md`. That file is the rules; this file is the roadmap.
Work **one phase at a time**. A phase is done when its exit criteria pass, not before.

## Thesis

Transmit is a narrow, AI-first, **messaging-native** CRM for multi-location SMBs
(team of 3, no funding — we win on focus, speed, and margin, not breadth).

- The wedge is communication, not record-keeping: two-way SMS, missed-call
  textback, and AI follow-up attached to a simple pipeline.
- **Telnyx is the SMS + voice provider from day one** (not Twilio). We hold
  Telnyx experience and adapter code in the nowco project (`~/Projects/@now/nowco`,
  `packages/sms`, Telnyx 10DLC flows) — port patterns, don't reinvent.
- Direct Telnyx pricing is a structural margin advantage over GoHighLevel-style
  competitors reselling Twilio. Messaging usage is our expansion revenue.
- One design-partner vertical first (pick one: home services, med spa, auto).
  Every phase ships something a design partner uses that week.

## Locked decisions

- Stack per `AGENTS.md`: Svelte 5 + SvelteKit, Tailwind, TanStack Query,
  PostgreSQL, **postgres.js (frozen)**, UUIDv7 app-generated IDs.
- Providers stay behind interfaces in `src/lib/server/providers/`:
  - `MessagingProvider` + `VoiceProvider` → Telnyx implementation.
  - `AiProvider` → Anthropic Claude implementation (Phase 5).
  - Domain code never imports a vendor SDK directly. One fake per interface
    for tests.
- Async work: a worker entry in this same codebase (separate entrypoint),
  fed by Postgres tables (`outbox` pattern). No Redis, no Kafka, no queues
  SaaS. Postgres until it demonstrably breaks.
- Webhooks from Telnyx are verified (Ed25519 signature), idempotent
  (dedupe on provider event id), and processed via the outbox worker —
  never inline business logic in the webhook route.
- Compliance is a feature, not a chore: 10DLC registration, STOP/HELP/opt-out
  handling, and TCPA quiet hours ship **with** SMS, not after it.

## Phase 1 — Vertical slice ✅ (complete)

Signup → workspace + default location → contacts → companies → opportunities
on a default pipeline → stage moves → contact timeline. Multi-tenant scoping
on every query. Domain/repo/e2e tests. Done.

## Phase 2 — SMS core (current)

**Goal:** a workspace can get a phone number and hold a two-way SMS
conversation with a contact, visible on the timeline and in an inbox.

In scope:

- `src/lib/server/providers/messaging.ts` interface + Telnyx implementation
  + in-memory fake.
- Number provisioning: search/buy one Telnyx number per **location**
  (numbers belong to locations, not accounts).
- 10DLC onboarding flow: collect brand/campaign info per account, submit via
  Telnyx, track registration status. Numbers can't send until approved —
  show that state honestly in the UI.
- Outbound SMS from a contact page; inbound via webhook; both appended to
  the contact timeline (`activities`) and a new `messages` table.
- Conversations inbox: list of contacts with latest message, unread state.
- Opt-out: STOP/UNSTOP/HELP handled automatically; `messaging_consent` on
  contacts; hard block on sending to opted-out contacts (enforced in domain
  layer, tested).
- Quiet hours per location timezone (block + queue until morning).
- Worker entry (`src/worker.ts` or equivalent) draining `outbox` for sends,
  webhook processing, and status updates. Delivery status on each message.

Out of scope: voice, MMS, group texts, campaigns/blasts, templates, AI.

Exit criteria:

- E2e (with fake provider): provision number → send SMS → receive inbound →
  both on timeline and inbox.
- Domain tests: opt-out blocks sends; quiet hours defer; tenant isolation on
  messages and numbers.
- One real number provisioned and one real conversation held against Telnyx
  sandbox/live from a dev workspace.
- Webhook route rejects bad signatures; replayed events are no-ops.

## Phase 3 — Voice + missed-call textback

**Goal:** the location number answers calls, and a missed call becomes an
automatic SMS within seconds. This is the demo that sells.

In scope:

- `VoiceProvider` interface + Telnyx Call Control implementation + fake.
- Inbound call handling on the location number: forward to a configured
  forwarding number (the owner's cell). No IVR, no softphone.
- Missed/unanswered/after-hours call → call logged on contact timeline
  (create contact from caller ID if unknown) → automatic SMS from a
  per-location template ("Sorry we missed you — how can we help?").
- Call log entries (direction, duration, outcome) as activities.
- Per-location settings page: forwarding number, business hours,
  missed-call template, on/off.

Out of scope: recording, transcription, softphone/WebRTC dialing, IVR trees,
voicemail drop, AI voice.

Exit criteria:

- Fake-provider e2e: inbound call event (unanswered) → contact created →
  textback sent → timeline shows call + SMS.
- Real test: call the dev workspace number from a cell, decline it, receive
  the textback.

## Phase 4 — Billing

**Goal:** charge money. No funding means revenue is the runway.

In scope:

- Stripe subscription per account (flat per-location price) + metered
  messaging usage (credit ledger in Postgres — port the event-sourced
  counter pattern from nowco, simplified).
- Free trial with a hard message cap; card required to provision a number.
- Usage page: messages/calls this period, per location.
- Dunning basics: failed payment → grace period → sending disabled (never
  delete data).

Out of scope: self-serve plan matrix, annual billing, invoicing customization,
reseller/agency billing.

Exit criteria: a stranger can sign up, add a card, provision a number, text,
and we get paid without a human in the loop. Usage on the invoice matches the
ledger in a test scenario.

## Phase 5 — AI layer

**Goal:** the "AI-first" part — on top of real conversation data, not before it.

In scope:

- `AiProvider` interface, Claude implementation (latest model via config).
- Suggested replies in the inbox (draft, human sends — human-in-the-loop
  first).
- Auto follow-up: opportunity idle in a stage N days → drafted nudge queued
  for owner approval.
- Conversation summary on the contact page.
- Guardrails: AI never auto-sends in Phase 5; every AI action is logged as
  an activity; per-account kill switch.

Out of scope: autonomous agents, AI voice answering, custom model settings UI.

Exit criteria: suggested replies and follow-up drafts work e2e with a fake
AI provider in tests and Claude in dev; opt-out and quiet-hour rules provably
apply to AI-drafted sends.

## Phase 6 — Lead capture + integration surface

**Goal:** fill the top of the funnel and open integration paths.

- Embeddable lead form (one form per location) posting into contacts +
  auto-first-SMS (consent checkbox captured — TCPA).
- Outbound webhooks (contact.created, message.received, opportunity.stage_changed)
  with signing + retries via the outbox.
- CSV import for contacts.

Exit criteria: a design partner's website form creates a contact that gets an
instant compliant SMS; a Zapier-style consumer can verify webhook signatures.

## Later / explicitly not now

Marketing blasts & campaigns, email channel (evaluate transmit.dev/nowco as
the provider when we get there), AI voice receptionist, softphone, custom
fields UI, reporting dashboards, agency/multi-account reselling, public API
product, mobile apps.

Forbidden infra stays forbidden: Go services, Redis, Kafka, Kubernetes,
Elasticsearch, microservices, Pub/Sub.

## Operating rules for every phase

- Ship behind the design partner's workflow; demo weekly.
- Every phase ends with the `AGENTS.md` report block, `sv check` clean,
  domain + repo + e2e tests green.
- New tables always carry `account_id`; messaging tables also carry
  `location_id`. Tenant-isolation tests extend to every new table.
- Compliance regressions (opt-out, quiet hours, consent) are release
  blockers, same as data leaks.
