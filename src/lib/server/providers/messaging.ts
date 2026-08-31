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
	contactEmail: string;
	useCase: string;
	sampleMessage: string;
};

export type NormalizedWebhookEvent =
	| {
			type: 'inbound';
			eventId: string;
			providerMessageId: string;
			from: string;
			to: string;
			text: string;
	  }
	| {
			type: 'status';
			eventId: string;
			providerMessageId: string;
			status: 'sent' | 'delivered' | 'failed';
			error: string | null;
	  };

export interface MessagingProvider {
	searchNumbers(areaCode: string | null): Promise<{ e164: string }[]>;
	purchaseNumber(e164: string): Promise<{ providerNumberId: string }>;
	sendMessage(input: { from: string; to: string; body: string }): Promise<{
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
