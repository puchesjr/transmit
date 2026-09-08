import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import type { AppError } from '$lib/server/errors';
import {
	confirmCheckout,
	getBillingSummary,
	parseCheckoutConfirm,
	startCheckout
} from '$lib/server/domain/billing';
import { getOnboardingSnapshot } from '$lib/server/domain/onboarding';
import type { SubscriptionChangedEvent } from '$lib/server/providers/billing';
import { FakeBillingProvider } from '$lib/server/providers/fake-billing';
import { applyCheckoutCompleted, getBillingAccount } from '$lib/server/repos/billing';
import { authContext, createWorkspace } from '../helpers';

/** Stripe-shaped provider: checkout redirects without activating anything locally. */
class HostedCheckoutProvider extends FakeBillingProvider {
	sessions = new Map<string, SubscriptionChangedEvent>();
	subscriptions = new Map<string, SubscriptionChangedEvent>();
	retrieveCalls = 0;

	override async createCheckout(input: Parameters<FakeBillingProvider['createCheckout']>[0]) {
		return {
			url: input.successUrl.replace('{CHECKOUT_SESSION_ID}', 'cs_test_hosted'),
			sessionId: 'cs_test_hosted'
		};
	}

	override async confirmCheckout(input: { accountId: string; sessionId: string }) {
		const event = this.sessions.get(input.sessionId) ?? null;
		if (event && event.accountId !== input.accountId) throw new Error('Checkout session ownership mismatch');
		return event;
	}

	override async retrieveSubscription(input: { accountId: string; customerId: string; subscriptionId: string }) {
		this.retrieveCalls += 1;
		return this.subscriptions.get(input.subscriptionId) ?? null;
	}
}

function trialEvent(accountId: string, suffix = ''): SubscriptionChangedEvent {
	const now = Date.now();
	return {
		type: 'subscription.changed',
		eventId: `checkout:cs_test_hosted${suffix}`,
		accountId,
		customerId: `cus_hosted_${accountId.replaceAll('-', '')}${suffix}`,
		subscriptionId: `sub_hosted_${accountId.replaceAll('-', '')}${suffix}`,
		status: 'trialing',
		cardOnFile: true,
		trialEndsAt: new Date(now + 14 * 86_400_000),
		currentPeriodStart: new Date(now),
		currentPeriodEnd: new Date(now + 14 * 86_400_000)
	};
}

describe('checkout confirmation', () => {
	it('validates the session id shape', () => {
		expect(parseCheckoutConfirm(null)).toEqual({ sessionId: null });
		expect(parseCheckoutConfirm({})).toEqual({ sessionId: null });
		expect(parseCheckoutConfirm({ sessionId: 'cs_test_abc123' })).toEqual({ sessionId: 'cs_test_abc123' });
		expect(() => parseCheckoutConfirm({ sessionId: '{CHECKOUT_SESSION_ID}' })).toThrow('sessionId');
		expect(() => parseCheckoutConfirm({ sessionId: 'evt_123' })).toThrow('sessionId');
	});

	it('puts the session placeholder on the success URL and never on the cancel URL', async () => {
		const sql = getSql();
		const ctx = authContext(await createWorkspace('confirm-url'));
		const provider = new FakeBillingProvider();
		const checkout = await startCheckout(sql, provider, ctx, 'http://kisocrm.test', { returnTo: 'onboarding' });
		expect(checkout.url).toMatch(/^http:\/\/kisocrm\.test\/onboarding\?checkout=success&session_id=cs_demo_[0-9a-f]+$/);
	});

	it('activates the trial from the returned session before any webhook arrives', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('confirm-session');
		const ctx = authContext(workspace);
		const provider = new HostedCheckoutProvider();
		await startCheckout(sql, provider, ctx, 'http://kisocrm.test', { returnTo: 'onboarding' });
		expect((await getOnboardingSnapshot(sql, provider, ctx)).currentStep).toBe('trial');

		provider.sessions.set('cs_test_hosted', trialEvent(ctx.accountId));
		const result = await confirmCheckout(sql, provider, ctx, 'cs_test_hosted');
		expect(result).toEqual({ status: 'trialing', confirmed: true });

		const snapshot = await getOnboardingSnapshot(sql, provider, ctx);
		expect(snapshot.trialStarted).toBe(true);
		expect(snapshot.cardOnFile).toBe(true);
		expect(snapshot.currentStep).toBe('register');
		// The later webhook is a no-op, and a second checkout is refused.
		await expect(confirmCheckout(sql, provider, ctx, 'cs_test_hosted')).resolves.toMatchObject({ confirmed: true });
		await expect(startCheckout(sql, provider, ctx, 'http://kisocrm.test')).rejects.toMatchObject({
			code: 'conflict'
		} satisfies Partial<AppError>);
	});

	it('reports an incomplete session honestly so the owner can start over', async () => {
		const sql = getSql();
		const ctx = authContext(await createWorkspace('confirm-incomplete'));
		const provider = new HostedCheckoutProvider();
		await startCheckout(sql, provider, ctx, 'http://kisocrm.test');
		const result = await confirmCheckout(sql, provider, ctx, 'cs_test_missing');
		expect(result).toEqual({ status: 'unconfigured', confirmed: false });
		await expect(startCheckout(sql, provider, ctx, 'http://kisocrm.test')).resolves.toBeTruthy();
	});

	it('refuses a session that belongs to another workspace', async () => {
		const sql = getSql();
		const victim = authContext(await createWorkspace('confirm-victim'));
		const attacker = authContext(await createWorkspace('confirm-attacker'));
		const provider = new HostedCheckoutProvider();
		provider.sessions.set('cs_test_hosted', trialEvent(victim.accountId));
		await expect(confirmCheckout(sql, provider, attacker, 'cs_test_hosted')).rejects.toMatchObject({
			code: 'forbidden'
		} satisfies Partial<AppError>);
		expect((await getBillingAccount(sql, attacker.accountId))?.status).toBe('unconfigured');
		expect((await getBillingAccount(sql, victim.accountId))?.status).toBe('unconfigured');
	});

	it('repairs a card-on-file account whose subscription webhook never landed', async () => {
		const sql = getSql();
		const ctx = authContext(await createWorkspace('confirm-stranded'));
		const provider = new HostedCheckoutProvider();
		const event = trialEvent(ctx.accountId);
		// Only checkout.session.completed was processed.
		await applyCheckoutCompleted(sql, ctx.accountId, event.customerId, event.subscriptionId);
		await expect(startCheckout(sql, provider, ctx, 'http://kisocrm.test')).rejects.toMatchObject({
			code: 'conflict'
		} satisfies Partial<AppError>);

		// Provider unreachable: reads still work and report the truth.
		const stranded = await getOnboardingSnapshot(sql, provider, ctx);
		expect(stranded).toMatchObject({ trialStarted: false, cardOnFile: true, currentStep: 'trial' });
		expect(await confirmCheckout(sql, provider, ctx, null)).toEqual({ status: 'unconfigured', confirmed: false });

		provider.subscriptions.set(event.subscriptionId, event);
		const healed = await getBillingSummary(sql, provider, ctx);
		expect(healed.status).toBe('trialing');
		expect(healed.cardOnFile).toBe(true);
		expect(provider.retrieveCalls).toBeGreaterThan(0);
		const calls = provider.retrieveCalls;
		await getOnboardingSnapshot(sql, provider, ctx);
		expect(provider.retrieveCalls).toBe(calls);
	});

	it('refuses a second checkout once a card is on file, even without a subscription id', async () => {
		const sql = getSql();
		const ctx = authContext(await createWorkspace('confirm-card-only'));
		const provider = new HostedCheckoutProvider();
		await startCheckout(sql, provider, ctx, 'http://kisocrm.test');
		await sql`
			update billing_accounts
			set card_on_file = true, pending_checkout_session_id = null
			where account_id = ${ctx.accountId}
		`;
		await expect(startCheckout(sql, provider, ctx, 'http://kisocrm.test')).rejects.toMatchObject({
			code: 'conflict'
		} satisfies Partial<AppError>);
	});

	it('lets only one of two overlapping demo checkouts activate', async () => {
		const sql = getSql();
		const ctx = authContext(await createWorkspace('confirm-parallel'));
		const provider = new FakeBillingProvider();
		const results = await Promise.allSettled([
			startCheckout(sql, provider, ctx, 'http://kisocrm.test'),
			startCheckout(sql, provider, ctx, 'http://kisocrm.test')
		]);
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
		expect((await getBillingAccount(sql, ctx.accountId))?.status).toBe('trialing');
	});

	it('blocks members from starting or confirming checkout', async () => {
		const sql = getSql();
		const owner = authContext(await createWorkspace('confirm-member'));
		const member = { ...owner, role: 'member' as const };
		const provider = new HostedCheckoutProvider();
		await expect(startCheckout(sql, provider, member, 'http://kisocrm.test')).rejects.toMatchObject({
			code: 'forbidden'
		} satisfies Partial<AppError>);
		await expect(confirmCheckout(sql, provider, member, 'cs_test_hosted')).rejects.toMatchObject({
			code: 'forbidden'
		} satisfies Partial<AppError>);
	});
});
