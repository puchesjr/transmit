import { refuseFakeInProduction } from './production';

/**
 * Provider boundary for transactional email: password resets today, nothing
 * else yet. Kiso sends through transmit.dev, which speaks the Resend request
 * shape, so the adapter is one POST. No vendor SDK.
 */
export type EmailMessage = {
	to: string;
	subject: string;
	text: string;
	html?: string;
};

export interface EmailProvider {
	readonly name: 'transmit' | 'fake';
	send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}

let provider: EmailProvider | undefined;

export async function getEmailProvider(): Promise<EmailProvider> {
	if (!provider) {
		const forced = process.env.EMAIL_PROVIDER?.trim();
		if (forced === 'fake' || (!process.env.TRANSMIT_API_KEY && forced !== 'transmit')) {
			refuseFakeInProduction('email', 'TRANSMIT_API_KEY and EMAIL_FROM');
			const { FakeEmailProvider } = await import('./fake-email');
			provider = new FakeEmailProvider();
		} else {
			const { TransmitEmailProvider } = await import('./transmit-email');
			provider = new TransmitEmailProvider();
		}
	}
	return provider;
}

export function setEmailProvider(override: EmailProvider | undefined): void {
	provider = override;
}
