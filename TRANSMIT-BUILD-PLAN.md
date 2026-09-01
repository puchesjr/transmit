# Transmit — Build Plan

Read together with `AGENTS.md`. That file is the rules; this file is the roadmap.
Work **one phase at a time**. A phase is done when its exit criteria pass, not before.

## Thesis

Transmit is a narrow, AI-first, **conversation-to-revenue operating system** for
multi-location home-service SMBs (team of 3, no funding — we win on focus,
speed, and margin, not breadth).

- The Inbox is the product. CRM records provide context, the pipeline records
  outcomes, and AI helps operate the queue.
- The wedge is the first five minutes of a lead: two-way SMS, missed-call
  textback, clear ownership, and AI follow-up attached to a simple pipeline.
- Transmit owns the path from inbound conversation to booked work. It does not
  replace field-service dispatch, estimating, invoicing, or accounting systems.
- **Telnyx is the SMS + voice provider from day one** (not Twilio). We hold
  Telnyx experience and adapter code in the nowco project (`~/Projects/@now/nowco`,
  `packages/sms`, Telnyx 10DLC flows) — port patterns, don't reinvent.
- Direct Telnyx pricing is a structural margin advantage over GoHighLevel-style
  competitors reselling Twilio. Messaging usage is our expansion revenue.
- Home services is the first design-partner vertical. Every phase ships
  something a design partner uses that week.

## Product model

- **Conversation** is the operational unit of work: it has a location, customer,
  owner, state, and eventual outcome.
- **Customer/contact** is the durable identity and consent record behind one or
  more interactions.
- **Opportunity/lead** is the commercial outcome of a conversation, not a
  separate CRM workflow users must maintain for its own sake.
- **Location** owns routing context, phone number, timezone, hours, and local
  compliance behavior.
- **Activity** is the immutable audit trail across customer, conversation, and
  opportunity context.

Primary navigation stays narrow: Inbox, Leads, Customers, Settings. Companies
remain supporting customer data rather than a primary workspace. Messaging
registration and numbers live under Settings. Do not add a generic dashboard;
the Inbox is the daily operating view.

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

## Phase 2 — SMS core ✅ (complete)

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
- Explicit `conversations` table as the tenant-scoped unit of work; messages
  reference a conversation rather than deriving threads from contacts.
- Conversations inbox: list of customer threads with latest message, unread
  state, owner context, and a customer context rail.
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
  conversations, messages, and numbers.
- One real number provisioned and one real conversation held against Telnyx
  sandbox/live from a dev workspace.
- Webhook route rejects bad signatures; replayed events are no-ops.

## Phase 3 — Voice + missed-call textback (implementation complete; live-provider validation pending)

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

## Phase 4A — Billing (implementation complete; live-provider validation pending)

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

## Phase 4B — Public launch surface ✅ (complete)

**Goal:** explain the product clearly, earn trust, and convert Product Hunt and
design-partner traffic into self-serve trials without promising unfinished AI.

In scope:

- A fast, responsive marketing homepage at `/` with a specific home-services
  promise: recover missed calls and turn conversations into booked work.
- Product sections for the shared Inbox, two-way SMS, missed-call textback,
  simple lead tracking, multi-location ownership, and compliance.
- Honest pricing connected to the Phase 4A subscription product; no fake plan
  matrix or enterprise theater.
- Clear signup and demo calls to action, product screenshots made from the real
  application, launch FAQ, privacy/terms links, social metadata, sitemap, and
  launch analytics with explicit consent.
- Product Hunt launch assets and a repeatable demo workspace that shows call →
  automatic textback → Inbox → booked-work workflow.

Out of scope: a CMS, blog platform, SEO content farm, fabricated testimonials,
generic AI claims, or marketing features that are not usable in the product.

Exit criteria: a stranger can understand the product in under a minute, see the
real workflow, choose the actual paid plan, start a trial, and complete the core
demo path on mobile or desktop; accessibility, metadata, and performance checks
pass before the Product Hunt launch.

Implementation status: complete locally, including an automated WCAG 2.2 A/AA
regression gate over the public site and populated product routes in light, dark,
desktop, and mobile states. Production deployment, manual assistive-technology
testing, live Stripe and Telnyx validation, legal review, and a traced production
performance audit remain launch gates; see `docs/PRODUCT-HUNT-LAUNCH.md`.

## Phase 5 — AI layer (implementation complete; live-provider validation pending)

**Goal:** the "AI-first" part — on top of real conversation data, not before it.

In scope:

- `AiProvider` interface, Claude implementation (latest model via config).
- Suggested reply choices in the inbox, optimized for speed-to-lead, clarity,
  empathy, and a concrete next step (draft only; a human always sends).
- Auto follow-up: opportunity idle in a stage N days → drafted nudge queued
  for owner approval.
- Conversation summary, detected intent/urgency, and recommended next action on
  the contact page.
- Guardrails: AI never auto-sends in Phase 5; every AI action is logged as
  an activity; per-account kill switch.

Out of scope: autonomous agents, AI voice answering, custom model settings UI.

Exit criteria: suggested replies and follow-up drafts work e2e with a fake
AI provider in tests and Claude in dev; opt-out and quiet-hour rules provably
apply to AI-drafted sends.

Implementation status: complete locally with the deterministic provider. The
provider boundary, Claude structured-output adapter, reply coach, customer
briefs, true-idle follow-up worker, settings kill switch, stale-input checks,
audit trail, and visible human approval flow are implemented and covered by
domain, repository, Playwright, and Axe tests. A development smoke test with a
real Anthropic key remains the Phase 5 exit gate before this phase is marked
complete.

## Phase 6A — Instant lead capture + integration surface (implementation complete locally; live-partner validation pending)

**Goal:** fill the top of the funnel and open integration paths.

- A small set of embeddable, vertical-specific lead forms per location:
  request service, request a quote, request an appointment, and ask a question.
- Capture source page, referrer, campaign attribution, requested service,
  preferred time, and durable consent evidence.
- Every submission matches or creates a contact, creates a conversation and
  lead, routes it to the correct location, and sends an immediate compliant SMS.
- Lightweight website launcher actions: Text us, Request an appointment, and
  Get a quote. This is deterministic capture, not an autonomous chatbot.
- Outbound webhooks (contact.created, message.received, opportunity.stage_changed)
  with signing + retries via the outbox.
- CSV import for contacts.

Exit criteria: a design partner's website form creates a contact that gets an
instant compliant SMS and appears in the correct Inbox; a Zapier-style consumer
can verify webhook signatures.

Implementation status: complete locally. Four location-scoped hosted forms, the
deterministic three-action launcher, durable attribution and consent evidence,
transactional customer/conversation/lead creation, compliant instant replies,
signed outbound webhook delivery with outbox retries, and consent-safe CSV import
are implemented. Domain tests verify the full record and signature path; the
Playwright scenario verifies website request → sent SMS → Inbox → lead on mobile;
the public and authenticated surfaces pass the light/dark desktop/mobile Axe gate.
A real design-partner embed, live Telnyx delivery, and one external webhook
consumer remain production validation gates.

## Phase 6B — Conversational booking

**Goal:** turn the proven website capture flow into an AI concierge that can
qualify a lead, offer real availability, and book an appointment safely.

In scope:

- AI website conversation using the Phase 5 provider and audit guardrails.
- Deterministic scheduling tools behind interfaces: get availability, hold a
  slot, book, cancel, and hand off to a human.
- Location-aware services, timezone, duration, and availability.
- Explicit human takeover, timeout, and escalation paths in the Inbox.
- Confirmation by SMS with the same opt-out and quiet-hours enforcement.

Out of scope: a generic form builder, open-ended chatbot builder, autonomous
promises, invented availability, dispatch, or replacing the customer's field
service scheduling system.

Exit criteria: a visitor can complete qualification and book a real available
slot end-to-end with a fake scheduler in tests and one design-partner scheduler
in development; uncertainty and unsupported requests route to a human.

## Later / explicitly not now

Marketing blasts & campaigns, email channel (evaluate transmit.dev/nowco as
the provider when we get there), AI voice receptionist, softphone, custom
fields UI, reporting dashboards, generic form/chatbot builders,
agency/multi-account reselling, public API product, mobile apps.

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
