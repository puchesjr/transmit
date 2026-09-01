import type { BillingStatus, UsageMetric } from '$lib/types';

export type NormalizedBillingEvent =
	| {
			type: 'checkout.completed';
			eventId: string;
			accountId: string;
			customerId: string;
			subscriptionId: string;
	  }
	| {
			type: 'subscription.changed';
			eventId: string;
			accountId: string;
			customerId: string;
			subscriptionId: string;
			status: BillingStatus;
			cardOnFile: boolean;
			trialEndsAt: Date | null;
			currentPeriodStart: Date | null;
			currentPeriodEnd: Date | null;
	  }
	| {
			type: 'invoice.payment_failed' | 'invoice.paid';
			eventId: string;
			accountId: string;
			customerId: string;
			subscriptionId: string | null;
	  };

export type CheckoutResult = {
	url: string;
	demoActivation?: {
		customerId: string;
		subscriptionId: string;
		trialEndsAt: Date;
		currentPeriodStart: Date;
		currentPeriodEnd: Date;
	};
};

export interface BillingProvider {
	readonly mode: 'stripe' | 'demo';
	createCheckout(input: {
		accountId: string;
		email: string;
		locationCount: number;
		customerId: string | null;
		successUrl: string;
		cancelUrl: string;
	}): Promise<CheckoutResult>;
	createPortal(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
	reportUsage(input: {
		customerId: string;
		metric: UsageMetric;
		quantity: number;
		identifier: string;
		occurredAt: Date;
	}): Promise<void>;
	verifyAndParseWebhook(rawBody: string, signature: string | null): NormalizedBillingEvent | null;
}

let provider: BillingProvider | undefined;

export async function getBillingProvider(): Promise<BillingProvider> {
	if (!provider) {
		const forced = process.env.BILLING_PROVIDER;
		if (forced === 'fake' || (!process.env.STRIPE_SECRET_KEY && forced !== 'stripe')) {
			const { FakeBillingProvider } = await import('./fake-billing');
			provider = new FakeBillingProvider();
		} else {
			const { StripeBillingProvider } = await import('./stripe-billing');
			provider = new StripeBillingProvider();
		}
	}
	return provider;
}

export function setBillingProvider(override: BillingProvider | undefined): void {
	provider = override;
}
