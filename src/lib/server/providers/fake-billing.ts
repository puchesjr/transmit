import type {
	BillingProvider,
	CheckoutResult,
	NormalizedBillingEvent,
	SubscriptionChangedEvent
} from './billing';

export const FAKE_BILLING_SIGNATURE = 'fake-billing-signature';

export class FakeBillingProvider implements BillingProvider {
	readonly mode = 'demo' as const;
 telecomPaid = true;
 telecomCharges: {identifier: string; amountCents: number}[] = [];
 async collectTelecomCharge(input: Parameters<BillingProvider['collectTelecomCharge']>[0]) {
  if (!this.telecomCharges.some(c => c.identifier === input.identifier)) this.telecomCharges.push({identifier:input.identifier,amountCents:input.amountCents});
  const invoiceId = `in_demo_${input.identifier}`;
  await input.onInvoiceCreated(invoiceId);
  return {invoiceId,url:null,paid:this.telecomPaid};
 }
	reported: { identifier: string; quantity: number }[] = [];

	async createCheckout(input: {
		accountId: string;
		email: string;
		locationCount: number;
		customerId: string | null;
		successUrl: string;
		cancelUrl: string;
	}): Promise<CheckoutResult> {
		void input.email;
		void input.locationCount;
		void input.cancelUrl;
		const now = new Date();
		const sessionId = `cs_demo_${input.accountId.replaceAll('-', '')}`;
		return {
			url: input.successUrl.replace('{CHECKOUT_SESSION_ID}', sessionId),
			sessionId,
			demoActivation: {
				customerId: input.customerId ?? `cus_demo_${input.accountId.replaceAll('-', '')}`,
				subscriptionId: `sub_demo_${input.accountId.replaceAll('-', '')}`,
				trialEndsAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
				currentPeriodStart: now,
				currentPeriodEnd: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
			}
		};
	}

	async confirmCheckout(input: { accountId: string; sessionId: string }): Promise<SubscriptionChangedEvent | null> {
		void input;
		return null;
	}

	async expireCheckout(sessionId: string): Promise<void> {
		void sessionId;
	}

	async retrieveSubscription(input: {
		accountId: string;
		customerId: string;
		subscriptionId: string;
	}): Promise<SubscriptionChangedEvent | null> {
		void input;
		return null;
	}

	async createPortal(input: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
		void input.customerId;
		return { url: `${input.returnUrl}?portal=demo` };
	}

	async reportUsage(input: { identifier: string; quantity: number }): Promise<void> {
		if (!this.reported.some((event) => event.identifier === input.identifier)) {
			this.reported.push({ identifier: input.identifier, quantity: input.quantity });
		}
	}

	verifyAndParseWebhook(rawBody: string, signature: string | null): NormalizedBillingEvent | null {
		if (signature !== FAKE_BILLING_SIGNATURE) throw new Error('Invalid webhook signature');
		const payload = JSON.parse(rawBody) as { event?: NormalizedBillingEvent };
		return payload.event ?? null;
	}

	async assertLiveConfig(): Promise<void> {}
}
