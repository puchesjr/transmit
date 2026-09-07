# Telecom COGS implementation — September 7, 2026

Telnyx remains the provider. This change hardens communications billing within the current Phase 6B work; it does not introduce another milestone or a provider migration.

## Customer pricing

| Charge | Customer amount | Collection |
| --- | ---: | --- |
| Business brand | $4.50 | Before initial registration submission |
| Campaign review | $15.00 | Before initial registration submission |
| Low Volume Mixed campaign, first three months | $4.50 | Included in the $24 initial registration invoice |
| Campaign renewal | $1.50/month | Starts after the prepaid three months |
| Local number with SMS enabled | $1.10/month/number | First month before purchase; monthly thereafter |
| SMS | One credit per segment, both directions | Existing 250-credit workspace allowance, then $0.02/segment |
| Voice | Actual USD provider cost, both legs and features | Combined with number renewal; sum microdollars and round up once to a cent |

A new workspace buying one number pays $25.10 initially, before software fees. After the campaign prepayment expires, fixed telecom rental is $2.60/month for one campaign and one number, plus usage. These are the current supported US local / EIN business / Low Volume Mixed rates. Other registration classes are not silently priced at this rate.

The software trial does not waive telecom charges. Submitted brand/review fees can be non-refundable. Rejected or ambiguous provider operations go to support reconciliation before any repeat submission. A new paid review needs separate customer approval. No general authorization for arbitrary carrier fees, penalties, or undisclosed surcharges is introduced.

Existing resources enroll prospectively when the owner accepts the schedule. Historical registration and usage costs are not back-billed. Rental continues while resources remain active, including after software cancellation; support must release the actual provider resources and update local status. This behavior is disclosed at acceptance.

Passing through provider charges does not eliminate all COGS. Payment processing, the included SMS allowance, software infrastructure, AI usage, and uncollected balances remain expenses. The $0.02 overage price includes carrier SMS surcharges rather than adding them again. Separate small recurring invoices also incur processor costs; subscription margin must cover them under this schedule. No automatic card-processing surcharge was added.

## SMS enforcement and metering

- A shared GSM-7 codec powers the composer preview and server-side enforcement. Smart quotes/dashes, accents without GSM equivalents, and decorative Unicode are normalized before persistence and dispatch. Supported GSM accented characters are retained.
- Substantive unsupported letters/numbers require rewriting, so a name, address, or non-Latin sentence is not silently erased. Empty results and messages over ten segments are rejected, never truncated.
- Basic GSM characters use one septet; extension characters use two. Limits are 160 units for one segment and 153 per concatenated segment, respecting escape boundaries. Unicode inbound estimates use UTF-16 boundaries when Telnyx does not provide `parts`.
- AI drafting instructions require GSM-compatible SMS. The server normalizes AI drafts and all SMS automations as well; prompt compliance alone is insufficient. Web chat is not SMS and does not consume SMS credits.
- Trial caps, monthly allowances, previews, and Stripe usage use segments. Included-credit allocation is serialized by account and billable quantity is frozen before the outbox reports it. Out-of-order webhooks cannot reuse an allowance already allocated to another event in the period.
- Telnyx requests explicitly specify `encoding: gsm7` and `type: SMS`. Incoming Unicode content remains intact because encoding costs have already been incurred.
- Provider segment counts and USD costs are retained. Outbound estimate/provider discrepancies generate `sms_segment_mismatch` logs for reconciliation; the system does not automatically adjust an already billed amount on a conflicting callback.
- Each outbound message has a durable dispatch claim and a correlation tag. An ambiguous network response is held for review rather than automatically sending another SMS. A verified tagged callback can recover its provider ID and meter usage once.

## Payment and voice controls

The owner explicitly accepts a versioned fee schedule. Registration/number purchases require a paid, durable invoice before calling Telnyx. Stable Stripe idempotency keys, a persisted invoice ID, ownership/amount checks, and an operation claim prevent duplicate collection or provider purchases. A stale ambiguous Stripe creation is held for reconciliation because Stripe idempotency keys expire.

Telecom invoices inherit the saved subscription card and use a hosted payment link for declines or authentication. Telecom invoice webhooks cannot accidentally reactivate a canceled software subscription. Pending recurring invoices get durable renewal retries. After three days overdue, new SMS and paid forwarding are blocked; this does not itself release rented resources or prevent inbound carrier charges.

Voice billing uses signed `call.cost` events rather than assuming one elapsed-minute rate. Both forwarded call legs and provider feature costs are recorded with decimal precision and deduplicated. Inconsistent totals/cost parts are marked for review and excluded from automatic invoicing. Late cost records are eligible for a later number invoice. Unknown message/call correlations use the bounded outbox failure path and require attention if exhausted.

## Rollout and reconciliation

1. Apply migrations 016, 017, and 018 before running the updated web/worker processes. They add SMS encoding/segments/cost facts, fee acceptance and charge/resource ledgers, voice costs, frozen billable usage, and SMS dispatch claims. Existing charged rows remain unchanged. Migration 015 belongs to the pre-existing onboarding work.
2. Confirm Stripe's configured message meter price is two cents **per segment** and does not apply a second included allowance. Test initial registration payment, declined/SCA payment, renewal, retry, and cancellation in Stripe test mode.
3. Enable `call_cost_in_webhooks: true` on the Telnyx Call Control application. Verify signed cost events for both legs against provider records before enabling live voice cost billing. Merely receiving call hangups is not enough to recover voice COGS.
4. Validate live GSM multipart delivery and the `parts`, `cost`, and correlation tags on final callbacks. Reconcile a sample of SMS/voice invoices against the Telnyx portal, including carrier surcharges and AMD. Tests use provider fakes/mocks and are not proof of live-provider billing.
5. For each account, monitor pending/review telecom charges, unallocated or `needs_review` voice costs, messages with differing estimated/provider segments, and exhausted outbox jobs. Reconcile partial registration purchases, failed number purchases, refunds, and releases with provider and Stripe records before resubmitting or charging again.
6. Confirm the actual Telnyx account rate sheet and applicable tax configuration. Pricing is versioned in `src/lib/pricing.ts`; rate increases need updated disclosures and consent handling, not silent changes to existing accepted terms. Automatic telecom tax assessment and arbitrary provider adjustments are not implemented here.

No deployment, live charge, Telnyx configuration change, or historical rebilling was performed as part of this local implementation. Live-provider verification remains a release gate.

## Validation and milestone report

Completed: GSM enforcement, segment accounting, customer fee acceptance, prepaid registration/number gates, recurring fee collection, actual voice cost capture, billing recovery safeguards, composer/pricing/onboarding/terms disclosures.

Tests: codec boundaries, Unicode normalization, multi-segment manual/automated/inbound SMS, tenant isolation, concurrent trial reservations, delayed/out-of-order usage allocation, payment gating, duplicate operations, calendar renewals, Stripe invoice/card/SCA safeguards, and two-leg voice reconciliation. Browser coverage includes two-segment SMS usage, fee acceptance, booking, AI, mobile, and WCAG A/AA checks. Final verification: 142 unit tests across 23 files and all 16 browser tests passed. `pnpm check` reports zero errors/warnings; `pnpm build` and `git diff --check` pass.

Migrations: 016–018, applied only in local verification. No new package dependency. Browser tests now use a dedicated `_e2e` database and a fresh fake-provider server. Fresh Docker volumes create it automatically; existing volumes require the one-time database creation described in README. This fixes shared-outbox interference discovered when another development worker attempted a test SMS with its own Telnyx configuration; the observed provider requests failed authentication.

Svelte 4 syntax: none introduced; Svelte 5 checks and component autofixer used. New tenant-owned data queries include account scope. Existing signed-webhook owner discovery and global outbox claiming remain deliberate infrastructure exceptions, not client-supplied tenant lookups.

Remaining issues: rollout/reconciliation steps above; processor and included-allowance costs remain in software margin. Next milestone: none started; continue the existing Phase 6B live-validation work.

## Official sources checked

- [Telnyx 10DLC fees and charges](https://support.telnyx.com/en/articles/5634625-10dlc-fees-and-charges): brand, review, Low Volume Mixed rate, and initial three-month collection.
- [Telnyx number pricing](https://telnyx.com/pricing/numbers): US local number and SMS capability charges.
- [Telnyx SMS send API](https://developers.telnyx.com/api-reference/messages/send-a-message): explicit encoding and request tags.
- [Telnyx Call Control application configuration](https://developers.telnyx.com/api-reference/call-control-applications/update-a-call-control-application): cost webhook enablement.
- [Stripe invoice payment method priority](https://docs.stripe.com/billing/invoices/subscription): invoice/subscription/customer payment method precedence.

## Stored templates and SMS/MMS comparison follow-up

Default SMS copy (registration samples, lead-capture replies, fake AI drafts and provider sample messages) now uses GSM-compatible punctuation. Missed-call, lead-capture and booking confirmation settings normalize before saving; send-time enforcement remains necessary after substituting names, locations and appointment text.

`pnpm exec tsx scripts/clean-sms-templates.ts` previews reusable stored templates and unused AI drafts. Add `--apply` to clean safe changes. The tool scopes every tenant-data operation by account, uses compare-and-swap updates, prints counts rather than message content, and leaves sent/received history, used AI artifacts and submitted registration evidence intact. Substantive unsupported text is reported for rewriting rather than erased. The authorized local cleanup updated 423 records across the local database inventory, with zero blocked records. Production databases were not accessed. No schema migration is required for this follow-up.

The pure `compareMessageCost` function reuses the segment algorithm and compares integer microdollar costs including carrier fees, optional additional MMS costs, and customer credits. It recommends MMS only when provider cost is strictly lower, customer credits do not increase, and rates, recipient support, payload validity and authorization are all explicitly confirmed. It does not send, change customer pricing, or activate MMS in the current SMS-only provider path. AI recommends concise GSM wording; it must not choose the transport or invent prices.

Illustrative US local outbound break-even using [Telnyx published pricing](https://telnyx.com/pricing/messaging), assuming the complete payload fits one billed MMS unit, before tax/lookup/retry costs:

| Destination | SMS per segment, including carrier | MMS total, including carrier | First cheaper MMS comparison |
| --- | ---: | ---: | --- |
| AT&T | $0.0075 | $0.024 | 4 SMS segments ($0.030) |
| T-Mobile | $0.0085 | $0.025 | 3 SMS segments ($0.0255) |
| Verizon | $0.0085 | $0.022 | 3 SMS segments ($0.0255) |

Three segments start at 307 ordinary GSM septets; four start at 460. Extension characters change the character threshold. T-Mobile's three-part saving is only $0.0005, so a lookup, fallback, or small rate change can eliminate it. Actual account rates and destination carrier determine the comparison; never hard-code “over 160 characters means MMS.”

Telnyx explicitly supports [long text without attachments using `type=MMS`](https://support.telnyx.com/en/articles/4450150-faqs-about-mms-at-telnyx). There is no universal MMS text-size limit across carriers/devices. Before activating switching, validate text-only payload delivery, number/campaign eligibility, MMS billing units, inbound replies, protocol-aware status/usage handling, throughput, and actual carrier costs. MMS fallback may become segmented SMS, so reconcile the actual transport and avoid an automatic duplicate send on an ambiguous response. Unknown capability/rates should keep SMS. No unnecessary image attachment is required.

Customer MMS pricing must be disclosed before enablement. The existing three-credit MMS constant is a pricing placeholder, not proof of a working or authorized MMS product. Prefer GSM SMS for short messages and enable optimized text-only MMS only after the end-to-end transport and billing work is complete. This follow-up evaluates that extension without starting a new milestone.

Follow-up verification: all 146 unit tests (25 files), all 16 browser tests, Svelte checks (zero errors/warnings), production build, and whitespace checks pass. Repeat local cleanup preview reports zero changes and zero blocked entries. No Svelte 4 syntax was introduced. Tenant template/draft reads and updates are account-scoped; the CLI's operator account inventory is intentional. No new dependency or schema migration was added. Live MMS transport remains unequipped and disabled; no new milestone was started.
