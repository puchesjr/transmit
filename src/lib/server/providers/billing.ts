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
 collectTelecomCharge(input: {
 accountId: string; customerId: string; subscriptionId?: string | null; identifier: string; invoiceId: string | null;
 description: string; amountCents: number; createdAt: Date;
 onInvoiceCreated: (id: string) => Promise<void>;
 }): Promise<{invoiceId: string; url: string | null; paid: boolean}>;
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

function telnyxProviderIsLive(forced: string | undefined): boolean {
	if (forced === 'fake') return false;
	if (forced === 'telnyx') return true;
	return Boolean(process.env.TELNYX_API_KEY?.trim());
}

/** True when messaging or voice will hit live Telnyx rather than the in-memory fake. */
export function liveCarrierConfigured(): boolean {
	return (
		telnyxProviderIsLive(process.env.MESSAGING_PROVIDER) ||
		telnyxProviderIsLive(process.env.VOICE_PROVIDER)
	);
}

export async function getBillingProvider(): Promise<BillingProvider> {
	if (!provider) {
		const forced = process.env.BILLING_PROVIDER;
		if (forced === 'fake' || (!process.env.STRIPE_SECRET_KEY && forced !== 'stripe')) {
			if (process.env.NODE_ENV === 'production') {
				throw new Error('The fake billing provider cannot be used in production');
			}
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
