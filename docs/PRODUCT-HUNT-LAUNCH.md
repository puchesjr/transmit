# Transmit — Product Hunt launch kit

## Positioning

**Name:** Transmit

**Tagline:** Turn missed calls into booked work.

**One-liner:** An AI-assisted SMS inbox that helps home-service teams respond faster, communicate better, and recover missed callers before the job goes somewhere else.

**Short description:** Transmit connects missed-call textback, two-way business SMS, human-reviewed AI replies, customer context, and a focused lead pipeline. It is built for the first five minutes of a home-service lead—not to replace the scheduling, dispatch, or accounting tools that run the rest of the job.

## Product Hunt description

Home-service teams still win a surprising amount of work on the phone. The problem is what happens when nobody can pick up.

Transmit gives every location a business number and automatically texts missed or after-hours callers. Replies arrive in a shared team inbox where AI can prepare fast, warm, or qualifying responses, summarize the customer’s intent and urgency, and draft an idle-lead follow-up. A person reviews and sends every message. When the conversation becomes real work, the team can create a lead, record its value, and move it through a small, focused pipeline.

What ships today:

- Shared team inbox and two-way SMS
- Human-reviewed AI reply choices and conversation briefs
- Idle-lead follow-up drafts queued for owner approval
- Website lead forms with an immediate compliant text reply
- A lightweight Text us / Request appointment / Get a quote launcher
- Missed-call and after-hours textback
- Customer and company context
- Simple lead pipeline
- Per-location phone numbers and ownership
- STOP/HELP, consent, quiet hours, and 10DLC workflow
- Self-serve trial, billing, and usage
- Signed outbound webhooks and consent-safe CSV customer import

Transmit is $99 per active location per month, plus $0.02 per sent or received message. The 14-day trial includes 50 outbound messages and requires a card before number provisioning.

## Maker comment

I built Transmit around one narrow moment: a homeowner calls, the team is busy, and the job is at risk before it ever reaches a CRM.

Instead of building another all-in-one field-service platform, I started with the communication loop itself. A missed call becomes a compliant text, the reply is visible to the whole team, and the resulting opportunity has an owner and a value. That is the product today.

There are no fabricated customer logos, autonomous-agent claims, or invented metrics in this launch. AI drafts and summarizes; the team keeps the send button. I would love feedback from owner-operators and office managers on whether this workflow is focused enough to earn a place at the front desk.

## First comment

Thanks for taking a look at Transmit. If you run or support a home-service business, I am especially curious about three things:

1. What happens to missed calls today?
2. Which customer messages are hardest for the team to keep accountable?
3. Where should a focused communication tool hand work back to your field-service system?

I will be here throughout launch day to answer questions and share the real product workflow.

## Gallery assets

1. `static/og.png` — Launch card: “Turn missed calls into booked work.”
2. `static/images/product-inbox.jpg` — The shared inbox and customer conversation.
3. `static/images/product-leads.jpg` — The focused lead pipeline from new lead to closed won.
4. `static/images/product-billing.jpg` — Trial, billing, and usage in the live product UI.

Do not add fabricated metrics, testimonials, review badges, integrations, autonomous-send claims, or scheduling claims to these assets.

## Repeatable five-minute demo

Use a fresh workspace so the narrative stays easy to follow.

1. Sign up and start the demo trial from Billing.
2. In Settings, complete the demo 10DLC registration and provision the first number.
3. Configure the forwarding number, business hours, and missed-call template.
4. Open Lead capture, copy a service-request link, and submit it as a homeowner.
5. Show the immediate text, new Inbox conversation, customer, and Lead-stage opportunity. Explain that appointment requests are confirmed by a person, not auto-booked.
6. Trigger a fake inbound call outside business hours. Explain that the production path uses Telnyx Call Control.
7. Show the missed-call event and automatic textback on the customer timeline.
8. Open Inbox, select the conversation, and show the customer context beside the thread.
9. Generate the three AI reply choices, choose one, show that it enters the composer, then send it as the human operator.
10. Open the customer profile and generate the customer brief with intent, urgency, and next action.
11. Move the captured lead to Closed Won.
12. Open Billing and show the location and message usage ledger.

The Playwright scenarios in `e2e/voice.e2e.ts` and `e2e/ai.e2e.ts` repeat the central call → textback → Inbox → human-reviewed AI reply → Closed Won workflow.

## Launch-day checklist

- [ ] Production domain and `PUBLIC_SITE_URL` configured
- [ ] Production PostgreSQL backups and restore drill verified
- [ ] Live Stripe products, prices, meter, webhook secret, and portal configured
- [ ] Live Telnyx API key, public key, messaging profile, voice connection, and webhooks configured
- [ ] Real card → provision number → send message → invoice reconciliation tested
- [ ] Real missed call → automatic textback tested from a cell phone
- [ ] Real website embed → form → Telnyx SMS → correct location Inbox tested
- [ ] External webhook consumer verifies the raw-body signature and receives a retry
- [ ] Privacy policy and terms reviewed by qualified counsel
- [ ] Support and privacy mailboxes receiving mail
- [ ] Optional analytics vendor configured only if its consent behavior is verified
- [ ] Social card preview, sitemap, robots, canonical URLs, and all CTAs checked on the production domain
- [x] Local Axe WCAG 2.2 A/AA suite passes in light/dark and desktop/mobile states
- [ ] Keyboard and screen-reader smoke test completed against the production build
- [ ] Mobile and desktop demo run once from a clean account
- [ ] Product Hunt copy and screenshots match the shipping product
- [ ] Claude development smoke test completed with the configured production model

Do not launch until the live-provider checks pass. The local fake providers prove the workflow, not carrier delivery or payment settlement.
