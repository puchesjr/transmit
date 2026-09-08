import { describe, expect, it } from 'vitest';
import { LAUNCH_PRICE, smsOverageCents, smsOverageCredits } from '$lib/pricing';
import { getSql } from '$lib/server/db';
import {
	assertCanDispatchMessage,
	assertCanForwardCall,
	processUsageReport,
	assertCanProvisionNumber,
	getBillingSummary,
	handleBillingWebhook,
	recordUsage,
	startCheckout,
	TRIAL_MESSAGE_CAP
} from '$lib/server/domain/billing';
import { drainOutbox } from '$lib/server/outbox';
import { AppError } from '$lib/server/errors';
import {
	FakeBillingProvider,
	FAKE_BILLING_SIGNATURE
} from '$lib/server/providers/fake-billing';
import { authContext, createWorkspace } from '../helpers';
import { FakeMessagingProvider, FakeVoiceProvider } from '$lib/server/providers/fake';
import { outboxHandlers } from '$lib/server/worker';
import { FakeAiProvider } from '$lib/server/providers/fake-ai';
import { FakeOutboundWebhookProvider } from '$lib/server/providers/fake-outbound-webhook';

describe('SMS overage at $0.02', () => {
	it('bills two cents per credit after the included allotment', () => {
		expect(LAUNCH_PRICE.messageCents).toBe(2);
		expect(LAUNCH_PRICE.messageDollars).toBe(0.02);
		expect(smsOverageCredits(0, LAUNCH_PRICE.includedSmsCredits)).toBe(0);
		expect(smsOverageCents(smsOverageCredits(0, LAUNCH_PRICE.includedSmsCredits))).toBe(0);
		expect(smsOverageCredits(LAUNCH_PRICE.includedSmsCredits - 1, 1)).toBe(0);
		expect(smsOverageCredits(LAUNCH_PRICE.includedSmsCredits, 1)).toBe(1);
		expect(smsOverageCents(1)).toBe(2);
		expect(smsOverageCredits(LAUNCH_PRICE.includedSmsCredits - 2, 5)).toBe(3);
		expect(smsOverageCents(3)).toBe(6);
		expect(smsOverageCredits(LAUNCH_PRICE.includedSmsCredits, 2)).toBe(2);
		expect(smsOverageCents(2)).toBe(4);
	});
});

describe('billing entitlements and dunning', () => {
	it('requires a card before number provisioning and activates a 14-day demo trial', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('billing-start');
		const ctx = authContext(workspace);
		const provider = new FakeBillingProvider();

		await expect(assertCanProvisionNumber(sql, ctx.accountId)).rejects.toMatchObject({
			code: 'validation'
		} satisfies Partial<AppError>);
		const checkout = await startCheckout(sql, provider, ctx, 'http://kisocrm.test');
		expect(checkout.url).toContain('/settings/billing?checkout=success');
		const summary = await getBillingSummary(sql, provider, ctx);

		expect(summary).toMatchObject({ status: 'trialing', cardOnFile: true, trialMessagesUsed: 0 });
		expect(new Date(summary.trialEndsAt!).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
		await expect(assertCanProvisionNumber(sql, ctx.accountId)).resolves.toBeUndefined();
	});

	it('enforces the hard outbound trial cap from the usage ledger', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('billing-cap');
		const ctx = authContext(workspace);
		const provider = new FakeBillingProvider();
		await startCheckout(sql, provider, ctx, 'http://kisocrm.test');

		for (let index = 0; index < TRIAL_MESSAGE_CAP; index += 1) {
			await recordUsage(sql, {
				accountId: ctx.accountId,
				locationId: ctx.locationId,
				metric: 'message_outbound',
				quantity: 1,
				sourceType: 'message',
				sourceId: `cap-${index}`
			});
		}

		await expect(assertCanDispatchMessage(sql, ctx.accountId)).rejects.toMatchObject({
			code: 'validation',
			message: expect.stringContaining('50')
		} satisfies Partial<AppError>);
	});

	it('does not report included SMS credits to Stripe', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('billing-meter');
		const ctx = authContext(workspace);
		const provider = new FakeBillingProvider();
		await startCheckout(sql, provider, ctx, 'http://kisocrm.test');
		for (const sourceId of ['meter-one', 'meter-two']) {
			await recordUsage(sql, {
				accountId: ctx.accountId,
				locationId: ctx.locationId,
				metric: 'message_outbound',
				quantity: 1,
				sourceType: 'message',
				sourceId
			});
		}
		await drainOutbox(
			sql,
			{ messaging: new FakeMessagingProvider(), voice: new FakeVoiceProvider(), billing: provider, ai: new FakeAiProvider(), webhook: new FakeOutboundWebhookProvider() },
			outboxHandlers
		);
		await drainOutbox(
			sql,
			{ messaging: new FakeMessagingProvider(), voice: new FakeVoiceProvider(), billing: provider, ai: new FakeAiProvider(), webhook: new FakeOutboundWebhookProvider() },
			outboxHandlers
		);
		const summary = await getBillingSummary(sql, provider, ctx);
		expect(summary.trialMessagesUsed).toBe(2);
		expect(provider.reported.reduce((sum, event) => sum + event.quantity, 0)).toBe(0);
		expect(provider.reported).toHaveLength(0);
	});

	it('reports only SMS credits above the included monthly allotment to Stripe', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('billing-overage');
		const ctx = authContext(workspace);
		const provider = new FakeBillingProvider();
		await startCheckout(sql, provider, ctx, 'http://kisocrm.test');
		for (let index = 0; index < LAUNCH_PRICE.includedSmsCredits + 2; index += 1) {
			await recordUsage(sql, {
				accountId: ctx.accountId,
				locationId: ctx.locationId,
				metric: index % 2 === 0 ? 'message_outbound' : 'message_inbound',
				quantity: 1,
				sourceType: 'message',
				sourceId: `overage-${index}`
			});
		}
		const providers = {
			messaging: new FakeMessagingProvider(),
			voice: new FakeVoiceProvider(),
			billing: provider,
			ai: new FakeAiProvider(),
			webhook: new FakeOutboundWebhookProvider()
		};
		let processed = 0;
		do {
			processed = await drainOutbox(sql, providers, outboxHandlers);
		} while (processed > 0);
		const reportedCredits = provider.reported.reduce((sum, event) => sum + event.quantity, 0);
		expect(reportedCredits).toBe(2);
		expect(provider.reported).toHaveLength(2);
		expect(smsOverageCents(reportedCredits)).toBe(4);
	});

	it('gives failed payments a grace period, then disables sending without deleting data', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('billing-dunning');
		const ctx = authContext(workspace);
		const provider = new FakeBillingProvider();
		await startCheckout(sql, provider, ctx, 'http://kisocrm.test');
		const before = await getBillingSummary(sql, provider, ctx);
		const customerId = `cus_demo_${ctx.accountId.replaceAll('-', '')}`;
		const raw = JSON.stringify({
			event: {
				type: 'invoice.payment_failed',
				eventId: `evt-failed-${ctx.accountId}`,
				accountId: ctx.accountId,
				customerId,
				subscriptionId: `sub_demo_${ctx.accountId.replaceAll('-', '')}`
			}
		});
		await handleBillingWebhook(sql, provider, raw, FAKE_BILLING_SIGNATURE);
		await expect(assertCanDispatchMessage(sql, ctx.accountId)).resolves.toBeUndefined();

		await sql`
			update billing_accounts set grace_ends_at = now() - interval '1 minute'
			where account_id = ${ctx.accountId}
		`;
		await expect(assertCanDispatchMessage(sql, ctx.accountId)).rejects.toMatchObject({
			code: 'validation'
		} satisfies Partial<AppError>);
		const after = await getBillingSummary(sql, provider, ctx);
		expect(after.status).toBe('past_due');
		expect(after.sendingDisabledAt).not.toBeNull();
		expect(after.usage).toHaveLength(before.usage.length);
	});
});

describe('billing webhook security', () => {
	it('rejects bad signatures and treats a replay as a no-op', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('billing-webhook');
		const ctx = authContext(workspace);
		const provider = new FakeBillingProvider();
		await startCheckout(sql, provider, ctx, 'http://kisocrm.test');
		const raw = JSON.stringify({
			event: {
				type: 'invoice.paid',
				eventId: `evt-paid-${ctx.accountId}`,
				accountId: ctx.accountId,
				customerId: `cus_demo_${ctx.accountId.replaceAll('-', '')}`,
				subscriptionId: `sub_demo_${ctx.accountId.replaceAll('-', '')}`,
				amountPaid: 0
			}
		});

		await expect(handleBillingWebhook(sql, provider, raw, 'bad')).rejects.toMatchObject({
			code: 'unauthorized'
		} satisfies Partial<AppError>);
		const first = await handleBillingWebhook(sql, provider, raw, FAKE_BILLING_SIGNATURE);
		const replay = await handleBillingWebhook(sql, provider, raw, FAKE_BILLING_SIGNATURE);
		expect(first.duplicate).toBe(false);
		expect(replay.duplicate).toBe(true);
		// Stripe sends invoice.paid for the $0 trial invoice; it must not end the trial early.
		expect((await getBillingSummary(sql, provider, ctx)).status).toBe('trialing');
	});

	it('restores an account to active only when invoice.paid follows a failed payment', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('billing-dunning-paid');
		const ctx = authContext(workspace);
		const provider = new FakeBillingProvider();
		await startCheckout(sql, provider, ctx, 'http://kisocrm.test');
		const customerId = `cus_demo_${ctx.accountId.replaceAll('-', '')}`;
		const subscriptionId = `sub_demo_${ctx.accountId.replaceAll('-', '')}`;
		const send = (
			type: 'invoice.payment_failed' | 'invoice.paid',
			suffix: string,
			amountPaid?: number
		) =>
			handleBillingWebhook(
				sql,
				provider,
				JSON.stringify({
					event: {
						type,
						eventId: `evt-${suffix}-${ctx.accountId}`,
						accountId: ctx.accountId,
						customerId,
						subscriptionId,
						...(type === 'invoice.paid' ? { amountPaid } : {})
					}
				}),
				FAKE_BILLING_SIGNATURE
			);
		await send('invoice.payment_failed', 'fail');
		expect((await getBillingSummary(sql, provider, ctx)).status).toBe('past_due');
		await send('invoice.paid', 'zero', 0);
		expect((await getBillingSummary(sql, provider, ctx)).status).toBe('past_due');
		await handleBillingWebhook(
			sql,
			provider,
			JSON.stringify({
				event: {
					type: 'invoice.paid',
					eventId: `evt-wrong-sub-${ctx.accountId}`,
					accountId: ctx.accountId,
					customerId,
					subscriptionId: 'sub_other',
					amountPaid: 2500
				}
			}),
			FAKE_BILLING_SIGNATURE
		);
		expect((await getBillingSummary(sql, provider, ctx)).status).toBe('past_due');
		await send('invoice.paid', 'recover', 2500);
		const after = await getBillingSummary(sql, provider, ctx);
		expect(after.status).toBe('active');
		expect(after.graceEndsAt).toBeNull();
	});
});

it('freezes billable segments before a delayed worker crosses the billing-period boundary',async()=>{
 const sql=getSql(); const ctx=authContext(await createWorkspace('billing-delayed'));
 const provider=new FakeBillingProvider(); await startCheckout(sql,provider,ctx,'http://kisocrm.test');
 await recordUsage(sql,{accountId:ctx.accountId,locationId:ctx.locationId,metric:'message_outbound',quantity:253,sourceType:'message',sourceId:'long-batch'});
 const [event]=await sql`select id,billable_quantity from usage_events where account_id=${ctx.accountId}`;
 expect(event.billable_quantity).toBe(3);
 await sql`update billing_accounts set current_period_start=now()+interval '1 month' where account_id=${ctx.accountId}`;
 await processUsageReport(sql,provider,{accountId:ctx.accountId,usageEventId:event.id});
 await processUsageReport(sql,provider,{accountId:ctx.accountId,usageEventId:event.id});
 expect(provider.reported.map(e=>e.quantity)).toEqual([3]);
});
it('blocks paid call forwarding after billing expires without applying the SMS trial cap to voice',async()=>{
 const sql=getSql(); const ctx=authContext(await createWorkspace('voice-billing'));
 await startCheckout(sql,new FakeBillingProvider(),ctx,'http://kisocrm.test');
 await recordUsage(sql,{accountId:ctx.accountId,locationId:ctx.locationId,metric:'message_outbound',quantity:50,sourceType:'message',sourceId:'cap'});
 await expect(assertCanForwardCall(sql,ctx.accountId)).resolves.toBeUndefined();
 await sql`update billing_accounts set status='canceled' where account_id=${ctx.accountId}`;
 await expect(assertCanForwardCall(sql,ctx.accountId)).rejects.toThrow('billing');
});

it('does not reuse the included allowance when an earlier inbound timestamp arrives late',async()=>{
 const sql=getSql(); const ctx=authContext(await createWorkspace('billing-out-of-order'));
 await startCheckout(sql,new FakeBillingProvider(),ctx,'http://kisocrm.test');
 await sql`update billing_accounts set current_period_start=now()-interval '1 day' where account_id=${ctx.accountId}`;
 await recordUsage(sql,{accountId:ctx.accountId,locationId:ctx.locationId,metric:'message_outbound',quantity:250,sourceType:'message',sourceId:'first'});
 await recordUsage(sql,{accountId:ctx.accountId,locationId:ctx.locationId,metric:'message_inbound',quantity:2,sourceType:'message',sourceId:'late',occurredAt:new Date(Date.now()-3600_000)});
 const [event]=await sql`select billable_quantity from usage_events where account_id=${ctx.accountId} and source_id='late'`;
 expect(event.billable_quantity).toBe(2);
});
