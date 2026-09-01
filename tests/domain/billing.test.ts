import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import {
	assertCanDispatchMessage,
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

describe('billing entitlements and dunning', () => {
	it('requires a card before number provisioning and activates a 14-day demo trial', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('billing-start');
		const ctx = authContext(workspace);
		const provider = new FakeBillingProvider();

		await expect(assertCanProvisionNumber(sql, ctx.accountId)).rejects.toMatchObject({
			code: 'validation'
		} satisfies Partial<AppError>);
		await startCheckout(sql, provider, ctx, 'http://transmit.test');
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
		await startCheckout(sql, provider, ctx, 'http://transmit.test');

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

	it('exports each ledger event once so metered invoice usage matches Postgres', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('billing-meter');
		const ctx = authContext(workspace);
		const provider = new FakeBillingProvider();
		await startCheckout(sql, provider, ctx, 'http://transmit.test');
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
		expect(provider.reported.reduce((sum, event) => sum + event.quantity, 0)).toBe(2);
		expect(new Set(provider.reported.map((event) => event.identifier)).size).toBe(2);
	});

	it('gives failed payments a grace period, then disables sending without deleting data', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('billing-dunning');
		const ctx = authContext(workspace);
		const provider = new FakeBillingProvider();
		await startCheckout(sql, provider, ctx, 'http://transmit.test');
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
		await startCheckout(sql, provider, ctx, 'http://transmit.test');
		const raw = JSON.stringify({
			event: {
				type: 'invoice.paid',
				eventId: `evt-paid-${ctx.accountId}`,
				accountId: ctx.accountId,
				customerId: `cus_demo_${ctx.accountId.replaceAll('-', '')}`,
				subscriptionId: `sub_demo_${ctx.accountId.replaceAll('-', '')}`
			}
		});

		await expect(handleBillingWebhook(sql, provider, raw, 'bad')).rejects.toMatchObject({
			code: 'unauthorized'
		} satisfies Partial<AppError>);
		const first = await handleBillingWebhook(sql, provider, raw, FAKE_BILLING_SIGNATURE);
		const replay = await handleBillingWebhook(sql, provider, raw, FAKE_BILLING_SIGNATURE);
		expect(first.duplicate).toBe(false);
		expect(replay.duplicate).toBe(true);
		expect((await getBillingSummary(sql, provider, ctx)).status).toBe('active');
	});
});
