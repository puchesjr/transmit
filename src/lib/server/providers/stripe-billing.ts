import Stripe from 'stripe';
import type { BillingStatus, UsageMetric } from '$lib/types';
import type { BillingProvider, NormalizedBillingEvent } from './billing';

type StripeObject = Record<string, unknown> & {
	id?: string;
	customer?: string | { id?: string };
	subscription?: string | { id?: string };
	status?: string;
	trial_end?: number | null;
	current_period_start?: number;
	current_period_end?: number;
	default_payment_method?: unknown;
	metadata?: Record<string, string>;
	client_reference_id?: string | null;
	parent?: {
		subscription_details?: {
			subscription?: string | { id?: string };
			metadata?: Record<string, string>;
		};
	};
	items?: { data?: Array<{ current_period_start?: number; current_period_end?: number }> };
};

function idOf(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
		return (value as { id: string }).id;
	}
	return null;
}

function dateOf(value: unknown): Date | null {
	return typeof value === 'number' ? new Date(value * 1000) : null;
}

function billingStatus(value: string | undefined): BillingStatus {
	if (value === 'trialing') return 'trialing';
	if (value === 'active') return 'active';
	if (value === 'canceled' || value === 'incomplete_expired' || value === 'paused') return 'canceled';
	return 'past_due';
}

function accountIdOf(object: StripeObject): string | null {
	return (
		object.metadata?.accountId ??
		object.parent?.subscription_details?.metadata?.accountId ??
		object.client_reference_id ??
		null
	);
}

export class StripeBillingProvider implements BillingProvider {
	readonly mode = 'stripe' as const;
	private readonly stripe: Stripe;
	private readonly webhookSecret: string;
	private readonly locationPriceId: string;
	private readonly messagePriceId: string;
	private readonly meterEventName: string;

	constructor() {
		const secretKey = process.env.STRIPE_SECRET_KEY;
		this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
		this.locationPriceId = process.env.STRIPE_LOCATION_PRICE_ID ?? '';
		this.messagePriceId = process.env.STRIPE_MESSAGE_PRICE_ID ?? '';
		this.meterEventName = process.env.STRIPE_MESSAGE_METER_EVENT_NAME ?? '';
		if (!secretKey || !this.webhookSecret || !this.locationPriceId || !this.messagePriceId || !this.meterEventName) {
			throw new Error('Stripe billing configuration is incomplete');
		}
		this.stripe = new Stripe(secretKey);
	}

	async createCheckout(input: {
		accountId: string;
		email: string;
		locationCount: number;
		customerId: string | null;
		successUrl: string;
		cancelUrl: string;
	}) {
		const session = await this.stripe.checkout.sessions.create({
			mode: 'subscription',
			client_reference_id: input.accountId,
			...(input.customerId ? { customer: input.customerId } : { customer_email: input.email }),
			line_items: [
				{ price: this.locationPriceId, quantity: Math.max(1, input.locationCount) },
				{ price: this.messagePriceId }
			],
			payment_method_collection: 'always',
			subscription_data: {
				trial_period_days: 14,
				metadata: { accountId: input.accountId }
			},
			metadata: { accountId: input.accountId },
			success_url: input.successUrl,
			cancel_url: input.cancelUrl
		});
		if (!session.url) throw new Error('Stripe Checkout did not return a URL');
		return { url: session.url };
	}

	async createPortal(input: { customerId: string; returnUrl: string }) {
		const session = await this.stripe.billingPortal.sessions.create({
			customer: input.customerId,
			return_url: input.returnUrl
		});
		return { url: session.url };
	}

	async reportUsage(input: {
		customerId: string;
		metric: UsageMetric;
		quantity: number;
		identifier: string;
		occurredAt: Date;
	}): Promise<void> {
		if (input.metric === 'call_second') return;
		await this.stripe.billing.meterEvents.create(
			{
				event_name: this.meterEventName,
				payload: { stripe_customer_id: input.customerId, value: String(input.quantity) },
				identifier: input.identifier,
				timestamp: Math.floor(input.occurredAt.getTime() / 1000)
			},
			{ idempotencyKey: input.identifier }
		);
	}

	verifyAndParseWebhook(rawBody: string, signature: string | null): NormalizedBillingEvent | null {
		if (!signature) throw new Error('Missing Stripe signature');
		const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
		const object = event.data.object as unknown as StripeObject;
		const accountId = accountIdOf(object);
		if (!accountId) return null;
		const customerId = idOf(object.customer);

		if (event.type === 'checkout.session.completed') {
			const subscriptionId = idOf(object.subscription);
			if (!customerId || !subscriptionId) return null;
			return { type: 'checkout.completed', eventId: event.id, accountId, customerId, subscriptionId };
		}
		if (
			event.type === 'customer.subscription.created' ||
			event.type === 'customer.subscription.updated' ||
			event.type === 'customer.subscription.deleted'
		) {
			const subscriptionId = object.id;
			if (!customerId || !subscriptionId) return null;
			const period = object.items?.data?.[0];
			return {
				type: 'subscription.changed',
				eventId: event.id,
				accountId,
				customerId,
				subscriptionId,
				status: event.type === 'customer.subscription.deleted' ? 'canceled' : billingStatus(object.status),
				cardOnFile: object.default_payment_method != null,
				trialEndsAt: dateOf(object.trial_end),
				currentPeriodStart: dateOf(object.current_period_start ?? period?.current_period_start),
				currentPeriodEnd: dateOf(object.current_period_end ?? period?.current_period_end)
			};
		}
		if (event.type === 'invoice.payment_failed' || event.type === 'invoice.paid') {
			if (!customerId) return null;
			return {
				type: event.type,
				eventId: event.id,
				accountId,
				customerId,
				subscriptionId: idOf(object.subscription ?? object.parent?.subscription_details?.subscription)
			};
		}
		return null;
	}
}
