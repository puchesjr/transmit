import Stripe from 'stripe';
import { LAUNCH_PRICE } from '$lib/pricing';
import type { BillingStatus, UsageMetric } from '$lib/types';
import type { BillingProvider, NormalizedBillingEvent, SubscriptionChangedEvent } from './billing';

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
	amount_paid?: number;
	total?: number;
	hosted_invoice_url?: string | null;
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

function subscriptionEvent(
	eventId: string,
	accountId: string,
	customerId: string,
	subscription: StripeObject,
	deleted = false
): SubscriptionChangedEvent | null {
	const subscriptionId = subscription.id;
	if (!subscriptionId) return null;
	const period = subscription.items?.data?.[0];
	return {
		type: 'subscription.changed',
		eventId,
		accountId,
		customerId,
		subscriptionId,
		status: deleted ? 'canceled' : billingStatus(subscription.status),
		cardOnFile: subscription.default_payment_method != null,
		trialEndsAt: dateOf(subscription.trial_end),
		currentPeriodStart: dateOf(subscription.current_period_start ?? period?.current_period_start),
		currentPeriodEnd: dateOf(subscription.current_period_end ?? period?.current_period_end)
	};
}

export class StripeBillingProvider implements BillingProvider {
	readonly mode = 'stripe' as const;
	private readonly stripe: Stripe;
	private readonly webhookSecret: string;
	private readonly locationPriceId: string;
	private readonly messagePriceId: string;
	private readonly meterEventName: string;
	private liveConfig: Promise<void> | null = null;

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

	async assertLiveConfig(): Promise<void> {
		this.liveConfig ??= this.verifyMessageMeterPrice();
		await this.liveConfig;
	}

	private async verifyMessageMeterPrice(): Promise<void> {
		const price = await this.stripe.prices.retrieve(this.messagePriceId);
		const unitAmount = price.unit_amount;
		const metered = price.recurring?.usage_type === 'metered';
		if (
			price.currency !== 'usd' ||
			price.billing_scheme === 'tiered' ||
			price.transform_quantity != null ||
			!metered ||
			unitAmount !== LAUNCH_PRICE.messageCents
		) {
			throw new Error(
				`Stripe message price ${this.messagePriceId} must be a USD metered per-unit price of ${LAUNCH_PRICE.messageCents} cents with no included-quantity transform`
			);
		}
	}

	async createCheckout(input: {
		accountId: string;
		email: string;
		locationCount: number;
		customerId: string | null;
		successUrl: string;
		cancelUrl: string;
	}) {
		await this.assertLiveConfig();
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

	async confirmCheckout(input: { accountId: string; sessionId: string }) {
		await this.assertLiveConfig();
		const session = (await this.stripe.checkout.sessions.retrieve(input.sessionId, {
			expand: ['subscription']
		})) as unknown as StripeObject & { subscription?: string | StripeObject | null };
		const accountId = accountIdOf(session);
		if (accountId !== input.accountId) throw new Error('Checkout session ownership mismatch');
		if (session.status !== 'complete') return null;
		const subscription = session.subscription;
		if (!subscription || typeof subscription === 'string') return null;
		const customerId = idOf(session.customer) ?? idOf(subscription.customer);
		if (!customerId || idOf(subscription.customer) !== customerId) return null;
		return subscriptionEvent(`checkout:${String(session.id)}`, accountId, customerId, subscription);
	}

	async retrieveSubscription(input: { accountId: string; customerId: string; subscriptionId: string }) {
		await this.assertLiveConfig();
		const subscription = (await this.stripe.subscriptions.retrieve(
			input.subscriptionId
		)) as unknown as StripeObject;
		if (idOf(subscription.customer) !== input.customerId) throw new Error('Subscription ownership mismatch');
		if (accountIdOf(subscription) !== input.accountId) throw new Error('Subscription ownership mismatch');
		return subscriptionEvent(`subscription:${String(subscription.id)}`, input.accountId, input.customerId, subscription);
	}

 async collectTelecomCharge(input: Parameters<BillingProvider['collectTelecomCharge']>[0]) {
  await this.assertLiveConfig();
  let invoiceId = input.invoiceId;
  if (!invoiceId) {
   // Stripe expires idempotency keys after 24 hours. Fail closed on an old
   // ambiguous creation rather than potentially collecting a second payment.
   if (Date.now() - input.createdAt.getTime() > 23 * 3600_000) throw new Error('Telecom invoice creation needs reconciliation before retry');
   // Checkout stores the card on the subscription, which a standalone invoice
   // does not automatically inherit.
   let paymentMethod: string | null = null;
   if (input.subscriptionId) {
    const subscription = await this.stripe.subscriptions.retrieve(input.subscriptionId);
    if (idOf(subscription.customer) !== input.customerId) throw new Error('Telecom subscription ownership mismatch');
    paymentMethod = idOf(subscription.default_payment_method);
   }
   const invoice = await this.stripe.invoices.create({customer:input.customerId,auto_advance:false,
    ...(paymentMethod ? {default_payment_method:paymentMethod} : {}),
    collection_method:'charge_automatically',pending_invoice_items_behavior:'exclude',
    metadata:{accountId:input.accountId,telecomChargeId:input.identifier}}, {idempotencyKey:`telecom:${input.identifier}:invoice`});
   invoiceId = invoice.id;
   await input.onInvoiceCreated(invoiceId);
  }
  let invoice = await this.stripe.invoices.retrieve(invoiceId);
  if (idOf(invoice.customer) !== input.customerId || invoice.metadata?.telecomChargeId !== input.identifier) throw new Error('Telecom invoice ownership mismatch');
  if (invoice.status === 'draft') {
   const items = await this.stripe.invoices.listLineItems(invoiceId,{limit:100});
   if (!items.data.length) {
    if (Date.now() - input.createdAt.getTime() > 23 * 3600_000) throw new Error('Telecom invoice item needs reconciliation before retry');
    await this.stripe.invoiceItems.create({customer:input.customerId,invoice:invoiceId,currency:'usd',
     amount:input.amountCents,description:input.description,metadata:{telecomChargeId:input.identifier}},
     {idempotencyKey:`telecom:${input.identifier}:item`});
   }
   invoice = await this.stripe.invoices.retrieve(invoiceId);
   if (invoice.total !== input.amountCents) throw new Error('Telecom invoice amount mismatch');
   invoice = await this.stripe.invoices.finalizeInvoice(invoiceId,{auto_advance:false}, {idempotencyKey:`telecom:${input.identifier}:finalize`});
  }
  if (invoice.status === 'open') {
   try { invoice = await this.stripe.invoices.pay(invoiceId,{off_session:true}, {idempotencyKey:`telecom:${input.identifier}:pay`}); }
   catch (error) {
    // Card declines / SCA leave an open invoice the customer can pay securely.
    if (!(error instanceof Stripe.errors.StripeCardError) && !(error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'invoice_no_payment_method_types')) throw error;
    invoice = await this.stripe.invoices.retrieve(invoiceId);
   }
  }
  if (invoice.status === 'void' || invoice.status === 'uncollectible') throw new Error('Telecom invoice requires support review');
  return {invoiceId,url:invoice.hosted_invoice_url ?? null,paid:invoice.status === 'paid'};
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
		await this.assertLiveConfig();
		// `value` is overage credit count. Stripe multiplies by the message Price
		// ($0.02 per unit, API unit_amount=2). Do not send dollars or cents.
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
		const customerId = idOf(object.customer);
		const telecomChargeId = object.metadata?.telecomChargeId;
		if (telecomChargeId) {
			if (event.type !== 'invoice.paid' || !accountId || !customerId || !object.id) return null;
			const amountCents = typeof object.amount_paid === 'number' ? object.amount_paid : object.total;
			if (typeof amountCents !== 'number' || amountCents <= 0) return null;
			return {
				type: 'telecom.invoice.paid',
				eventId: event.id,
				accountId,
				customerId,
				chargeId: telecomChargeId,
				invoiceId: object.id,
				amountCents,
				invoiceUrl: typeof object.hosted_invoice_url === 'string' ? object.hosted_invoice_url : null
			};
		}
		if (!accountId) return null;

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
			if (!customerId) return null;
			return subscriptionEvent(
				event.id,
				accountId,
				customerId,
				object,
				event.type === 'customer.subscription.deleted'
			);
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
