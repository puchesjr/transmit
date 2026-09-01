import type { BillingProvider, CheckoutResult, NormalizedBillingEvent } from './billing';

export const FAKE_BILLING_SIGNATURE = 'fake-billing-signature';

export class FakeBillingProvider implements BillingProvider {
	readonly mode = 'demo' as const;
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
		return {
			url: input.successUrl,
			demoActivation: {
				customerId: input.customerId ?? `cus_demo_${input.accountId.replaceAll('-', '')}`,
				subscriptionId: `sub_demo_${input.accountId.replaceAll('-', '')}`,
				trialEndsAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
				currentPeriodStart: now,
				currentPeriodEnd: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
			}
		};
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
}
