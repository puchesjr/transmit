import { log } from '../logger';
import type { EmailMessage, EmailProvider } from './email';

/** Development and test only. Keeps every message in memory; never logs a body. */
export class FakeEmailProvider implements EmailProvider {
	readonly name = 'fake' as const;
	readonly sent: EmailMessage[] = [];

	async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
		this.sent.push(message);
		log('info', 'email_sent_fake', { to: message.to, subject: message.subject });
		return { providerMessageId: `fake-email-${this.sent.length}` };
	}
}
