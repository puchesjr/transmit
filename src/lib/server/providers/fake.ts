import type {
	MessagingProvider,
	NormalizedWebhookEvent,
	RegistrationInput,
	RegistrationStatus
} from './messaging';
import { TelnyxMessagingProvider } from './telnyx';
import { TelnyxVoiceProvider } from './telnyx-voice';
import type { NormalizedVoiceWebhookEvent, VoiceProvider } from './voice';

export const FAKE_WEBHOOK_SIGNATURE = 'fake-signature';

/**
 * In-memory provider for dev and tests. Registrations approve instantly,
 * sends always succeed, and webhooks accept Telnyx-shaped payloads signed
 * with FAKE_WEBHOOK_SIGNATURE.
 */
export class FakeMessagingProvider implements MessagingProvider {
	private seq = 0;
	sent: { from: string; to: string; body: string; providerMessageId: string }[] = [];

	async searchNumbers(areaCode: string | null): Promise<{ e164: string }[]> {
		// Randomized so repeated dev/e2e runs never collide on the globally-unique e164.
		const line = () => String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0');
		return Array.from({ length: 5 }, () => ({
			e164: `+1${areaCode ?? '555'}${line()}`
		}));
	}

	async purchaseNumber(e164: string): Promise<{ providerNumberId: string }> {
		return { providerNumberId: `fake-number-${e164}` };
	}

	async sendMessage(input: { from: string; to: string; body: string }): Promise<{
		providerMessageId: string;
	}> {
		this.seq += 1;
		const providerMessageId = `fake-msg-${this.seq}-${Math.random().toString(16).slice(2, 8)}`;
		this.sent.push({ ...input, providerMessageId });
		return { providerMessageId };
	}

	async submitRegistration(input: RegistrationInput): Promise<{
		brandId: string;
		campaignId: string;
		status: RegistrationStatus;
	}> {
		void input;
		this.seq += 1;
		return { brandId: `fake-brand-${this.seq}`, campaignId: `fake-campaign-${this.seq}`, status: 'approved' };
	}

	async getRegistrationStatus(): Promise<RegistrationStatus> {
		return 'approved';
	}

	verifyWebhook(rawBody: string, signature: string | null): boolean {
		void rawBody;
		return signature === FAKE_WEBHOOK_SIGNATURE;
	}

	parseWebhook(payload: unknown): NormalizedWebhookEvent | null {
		// Same wire shape as Telnyx so e2e payloads look like production traffic.
		return TelnyxMessagingProvider.prototype.parseWebhook.call(this, payload);
	}
}

export class FakeVoiceProvider implements VoiceProvider {
	answered: { callControlId: string; commandId: string }[] = [];
	transferred: {
		callControlId: string;
		to: string;
		from: string;
		commandId: string;
		timeoutSeconds: number;
	}[] = [];
	rejected: { callControlId: string; commandId: string }[] = [];

	async answerCall(input: { callControlId: string; commandId: string }): Promise<void> {
		this.answered.push(input);
	}

	async transferCall(input: {
		callControlId: string;
		to: string;
		from: string;
		commandId: string;
		timeoutSeconds: number;
	}): Promise<void> {
		this.transferred.push(input);
	}

	async rejectCall(input: { callControlId: string; commandId: string }): Promise<void> {
		this.rejected.push(input);
	}

	verifyWebhook(rawBody: string, signature: string | null): boolean {
		void rawBody;
		return signature === FAKE_WEBHOOK_SIGNATURE;
	}

	parseWebhook(payload: unknown): NormalizedVoiceWebhookEvent | null {
		return TelnyxVoiceProvider.prototype.parseWebhook.call(this, payload);
	}
}
