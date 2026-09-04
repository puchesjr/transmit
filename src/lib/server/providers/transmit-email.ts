import type { EmailMessage, EmailProvider } from './email';

/**
 * transmit.dev at the Resend-compatible path: POST /emails with from, to,
 * subject, text/html. EMAIL_FROM must be an approved sender on the account's
 * verified domain, or Transmit refuses the message at the door.
 */
export class TransmitEmailProvider implements EmailProvider {
	readonly name = 'transmit' as const;
	private readonly apiKey: string;
	private readonly from: string;
	private readonly baseUrl: string;

	constructor() {
		this.apiKey = process.env.TRANSMIT_API_KEY ?? '';
		if (!this.apiKey) throw new Error('TRANSMIT_API_KEY is not set');
		this.from = process.env.EMAIL_FROM ?? '';
		if (!this.from) throw new Error('EMAIL_FROM is not set');
		this.baseUrl = (process.env.TRANSMIT_API_BASE_URL || 'https://api.transmit.dev').replace(/\/$/, '');
	}

	async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
		const response = await fetch(`${this.baseUrl}/emails`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${this.apiKey}`,
				'content-type': 'application/json',
				accept: 'application/json'
			},
			body: JSON.stringify({
				from: this.from,
				to: message.to,
				subject: message.subject,
				text: message.text,
				...(message.html ? { html: message.html } : {})
			})
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new Error(`Transmit refused the email (${response.status}): ${detail.slice(0, 200)}`);
		}
		const body = (await response.json().catch(() => ({}))) as { id?: string };
		return { providerMessageId: body.id ?? '' };
	}
}
