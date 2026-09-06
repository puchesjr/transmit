# Phase 6B security review — September 6, 2026

Reviewed the current working-tree changes relative to `cd0f3bd`, including the untracked conversational booking implementation and CI/deployment configuration. The working tree does not establish authorship of individual changes. This review stays within Phase 6B.

## Completed

- **P1 — Public booking conversation disclosure:** Matching a phone number reused the CRM conversation, and the public API and AI received its full message history. Added explicit, tenant-scoped message ownership by booking session. Public state and AI context now read only that session's web messages; the authenticated Inbox still sees the full conversation. Overlapping sessions remain isolated.
- **P1 — Unverified customer identity and consent:** Booking could match an existing customer by email, schedule against that customer's stored phone/email, and reset their consent. Booking now matches only by phone, does not mutate an existing contact, and snapshots the visitor's submitted identity for scheduler calls and greetings. A prior STOP remains in force. Contact matching is serialized per tenant and phone.
- **P2 — Scheduler cleanup loss and cancellation races:** Cleanup failures were logged without durable recovery. Cleanup and customer cancellation intent now persist in the Postgres outbox before the provider call. Retries use the same provider idempotency key, and cancellation reads/writes share the confirmation transaction lock. Cancellation failures leave a durable retry while preserving the appointment state until provider success.
- **P2 — Slot and settings edge cases:** Validate slot duration and timezone before offering. Compare timestamp instants across equivalent ISO offset representations, because Postgres normalizes held timestamps. Saving a hold now requires the slot to remain in the current offered set and the session to remain unexpired. New chat turns cannot extend an existing hold. Existing chats check booking/service/AI pause settings before scheduling; legacy sessions without an identity snapshot hand off.
- **P2 — Public endpoint resource use:** Starting sessions now checks the IP quota under a transaction lock, preventing parallel requests from bypassing it. Public chat input is bounded to 40 inbound turns per session before additional AI/outbox work is rejected.
- **P2 — Telnyx false assignment success:** A conflict no longer automatically marks campaign assignment successful. The adapter verifies the exact number, campaign, and ASSIGNED status using the [Telnyx retrieval contract](https://developers.telnyx.com/api-reference/phone-number-campaigns/get-single-phone-number-campaign). Redirects are refused and requests have a timeout. Scheduler requests also refuse redirects and reject empty hold/booking identifiers.
- **P2 — Regression and deployment gates:** Server-only changes trigger browser checks; CI checks production compilation and runs the complete unit suite, avoiding import-based selection skipping dynamically loaded SQL migrations. Cloud Build no longer overwrites the scheduler selection with `fake` on every deploy. It retains the application's production refusal of fake scheduling.

No dependencies added. No new product pages or API routes.

## Tests added / passing

- Nine new regression tests cover overlapping-session privacy and AI context, tenant isolation, email/phone identity and STOP preservation, ISO offsets, invalid slots, failed cleanup replay, concurrent start limits, paused booking, and failed customer-cancellation replay; an existing provider test also checks redirect refusal.
- Full Vitest suite: **100 tests across 17 files passed**.
- Full Playwright suite: **11 scenarios passed**, including the booking flow, Axe accessibility/responsive coverage, and existing product flows.
- Booking Playwright flow rerun after the final pause/cancellation fixes: **passed**.
- `pnpm check`: **0 errors, 0 warnings**.
- `pnpm build`: **passed**.
- `git diff --check`: **passed**.

## Migrations

Added `013_booking_session_privacy.sql`, applied and tested against local test PostgreSQL. Apply it before deploying this application version. Existing migrations 010–012 were preserved.

Historical web messages cannot safely be attributed to overlapping sessions. They remain in the authenticated Inbox and are intentionally excluded from public session history. Existing booking sessions lack a visitor identity snapshot and require human handoff before further automated scheduling.

## Svelte 4 syntax found?

None in the source scan. No Svelte components were modified in this review.

## Queries without account_id?

None added for customer-data reads, updates, or deletes. New message and cleanup lookups explicitly use the tenant ID. Existing global worker dispatch, migration metadata, and advisory-lock operations are infrastructure operations, not tenant-authorized customer lookups.

## Remaining issues

- Live design-partner scheduler, AI, and Telnyx smoke tests remain pending, as already recorded in the build plan. Tests use deterministic providers and mocked HTTP contracts.
- Scheduler timeouts with an unknown external outcome continue to require human reconciliation; the application does not claim a booking succeeded on uncertainty. Durable cleanup retries still have the existing outbox attempt limit and require operational attention if exhausted.
- No deployment or real provider operations were performed. A deployment that already has `SCHEDULER_PROVIDER=fake` must be explicitly configured with a real scheduler; removing the hardcoded Cloud Build override does not alter an existing service's environment by itself.
- Manual assistive-technology and production performance validation remain existing launch gates.

## Next milestone (do not start it)

Finish Phase 6B's live-provider/design-partner validation. No later milestone started.
