/**
 * Provider boundary for SMS. Domain code depends on this interface only;
 * Telnyx (and the test fake) live behind it. No vendor SDKs elsewhere.
 */

export type RegistrationStatus = 'submitted' | 'approved' | 'rejected';

export type RegistrationInput = {
	legalName: string;
	ein: string | null;
	website: string | null;
	address: string;
	city: string;
	region: string;
	postalCode: string;
	contactEmail: string;
	contactPhone: string;
	useCase: string;
	sampleMessage: string;
};

export type NormalizedWebhookEvent =
	| {
			type: 'inbound';
			parts?: number;
			costUsd?: string;
			eventId: string;
			providerMessageId: string;
			from: string;
			to: string;
			text: string;
	  }
	| {
			type: 'status';
			clientMessageId?: string;
			parts?: number;
			costUsd?: string;
			eventId: string;
			providerMessageId: string;
			from: string;
			status: 'sent' | 'delivered' | 'failed';
			error: string | null;
	  };

export type NumberQuote = {
	e164: string;
	monthlyCents: number;
	upfrontCents: number;
};

export class NumberPurchaseError extends Error {
	readonly status: 'failed' | 'pending';
	constructor(status: 'failed' | 'pending', message: string) {
		super(message);
		this.name = 'NumberPurchaseError';
		this.status = status;
	}
}

export interface MessagingProvider {
	searchNumbers(areaCode: string | null): Promise<NumberQuote[]>;
	quoteNumber(e164: string): Promise<NumberQuote | null>;
	purchaseNumber(e164: string): Promise<{ providerNumberId: string }>;
	assignNumberToCampaign(input: { phoneNumber: string; campaignId: string }): Promise<void>;
	sendMessage(input: { from: string; to: string; body: string; clientMessageId?: string }): Promise<{
		providerMessageId: string;
	}>;
	submitRegistration(input: RegistrationInput): Promise<{
		brandId: string;
		campaignId: string;
		status: RegistrationStatus;
	}>;
	getRegistrationStatus(brandId: string, campaignId: string): Promise<RegistrationStatus>;
	verifyWebhook(rawBody: string, signature: string | null, timestamp: string | null): boolean;
	parseWebhook(payload: unknown): NormalizedWebhookEvent | null;
}

let provider: MessagingProvider | undefined;

export async function getMessagingProvider(): Promise<MessagingProvider> {
	if (!provider) {
		const forced = process.env.MESSAGING_PROVIDER;
		if (forced === 'fake' || (!process.env.TELNYX_API_KEY && forced !== 'telnyx')) {
			if (process.env.NODE_ENV === 'production') {
				throw new Error('The fake messaging provider cannot be used in production');
			}
			const { FakeMessagingProvider } = await import('./fake');
			provider = new FakeMessagingProvider();
		} else {
			const { TelnyxMessagingProvider } = await import('./telnyx');
			provider = new TelnyxMessagingProvider();
		}
	}
	return provider;
}

export function setMessagingProvider(override: MessagingProvider | undefined): void {
	provider = override;
}
