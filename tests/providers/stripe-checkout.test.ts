import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
	checkout: { sessions: { retrieve: vi.fn() } },
	subscriptions: { retrieve: vi.fn() },
	prices: { retrieve: vi.fn() }
}));
vi.mock('stripe', () => ({
	default: class {
		static errors = {};
		checkout = mock.checkout;
		subscriptions = mock.subscriptions;
		prices = mock.prices;
	}
}));
import { StripeBillingProvider } from '$lib/server/providers/stripe-billing';

const subscription = {
	id: 'sub_one',
	customer: 'cus_one',
	status: 'trialing',
	trial_end: 1_800_000_000,
	default_payment_method: 'pm_one',
	metadata: { accountId: 'account-one' },
	items: { data: [{ current_period_start: 1_798_000_000, current_period_end: 1_800_000_000 }] }
};

beforeEach(() => {
	vi.resetAllMocks();
	for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_LOCATION_PRICE_ID', 'STRIPE_MESSAGE_PRICE_ID', 'STRIPE_MESSAGE_METER_EVENT_NAME']) {
		vi.stubEnv(key, 'test-only');
	}
	mock.prices.retrieve.mockResolvedValue({
		id: 'price_message', unit_amount: 2, currency: 'usd', billing_scheme: 'per_unit',
		recurring: { usage_type: 'metered' }, transform_quantity: null
	});
	mock.checkout.sessions.retrieve.mockResolvedValue({
		id: 'cs_test_one', status: 'complete', customer: 'cus_one', client_reference_id: 'account-one',
		metadata: { accountId: 'account-one' }, subscription
	});
	mock.subscriptions.retrieve.mockResolvedValue(subscription);
});
afterEach(() => vi.unstubAllEnvs());

it('turns a completed checkout session into the same state the subscription webhook carries', async () => {
	const event = await new StripeBillingProvider().confirmCheckout({ accountId: 'account-one', sessionId: 'cs_test_one' });
	expect(mock.checkout.sessions.retrieve).toHaveBeenCalledWith('cs_test_one', { expand: ['subscription'] });
	expect(event).toEqual({
		type: 'subscription.changed',
		eventId: 'checkout:cs_test_one',
		accountId: 'account-one',
		customerId: 'cus_one',
		subscriptionId: 'sub_one',
		status: 'trialing',
		cardOnFile: true,
		trialEndsAt: new Date(1_800_000_000 * 1000),
		currentPeriodStart: new Date(1_798_000_000 * 1000),
		currentPeriodEnd: new Date(1_800_000_000 * 1000)
	});
});

it('returns nothing for an open session and refuses another workspace’s session', async () => {
	mock.checkout.sessions.retrieve.mockResolvedValueOnce({
		id: 'cs_test_one', status: 'open', customer: null, client_reference_id: 'account-one', metadata: {}, subscription: null
	});
	expect(await new StripeBillingProvider().confirmCheckout({ accountId: 'account-one', sessionId: 'cs_test_one' })).toBeNull();
	await expect(
		new StripeBillingProvider().confirmCheckout({ accountId: 'account-two', sessionId: 'cs_test_one' })
	).rejects.toThrow('ownership');
});

it('re-reads a subscription only for its own customer and workspace', async () => {
	const provider = new StripeBillingProvider();
	const event = await provider.retrieveSubscription({ accountId: 'account-one', customerId: 'cus_one', subscriptionId: 'sub_one' });
	expect(event).toMatchObject({ eventId: 'subscription:sub_one', status: 'trialing', subscriptionId: 'sub_one' });
	await expect(
		provider.retrieveSubscription({ accountId: 'account-one', customerId: 'cus_other', subscriptionId: 'sub_one' })
	).rejects.toThrow('ownership');
	await expect(
		provider.retrieveSubscription({ accountId: 'account-two', customerId: 'cus_one', subscriptionId: 'sub_one' })
	).rejects.toThrow('ownership');
});
