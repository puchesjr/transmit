import type {
	MessagingProvider,
	NormalizedWebhookEvent,
	NumberQuote,
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
	/** Live TCR stays submitted for days; the fake approves unless a test overrides this. */
	registrationStatus: RegistrationStatus = 'approved';
	sent: { from: string; to: string; body: string; providerMessageId: string }[] = [];
	assigned: { phoneNumber: string; campaignId: string }[] = [];

	async searchNumbers(areaCode: string | null): Promise<NumberQuote[]> {
		// Randomized so repeated dev/e2e runs never collide on the globally-unique e164.
		const line = () => String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0');
		return Array.from({ length: 5 }, () => ({
			e164: `+1${areaCode ?? '555'}${line()}`,
			monthlyCents: 110,
			upfrontCents: 110
		}));
	}

	async quoteNumber(e164: string): Promise<NumberQuote | null> {
		return { e164, monthlyCents: 110, upfrontCents: 110 };
	}

	async purchaseNumber(e164: string): Promise<{ providerNumberId: string }> {
		return { providerNumberId: `fake-number-${e164}` };
	}

	async assignNumberToCampaign(input: { phoneNumber: string; campaignId: string }): Promise<void> {
		if (
			!this.assigned.some(
				(row) => row.phoneNumber === input.phoneNumber && row.campaignId === input.campaignId
			)
		) {
			this.assigned.push(input);
		}
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
		return {
			brandId: `fake-brand-${this.seq}`,
			campaignId: `fake-campaign-${this.seq}`,
			status: this.registrationStatus
		};
	}

	async getRegistrationStatus(): Promise<RegistrationStatus> {
		return this.registrationStatus;
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
	dialed: {
		callControlId: string;
		to: string;
		from: string;
		commandId: string;
		timeoutSeconds: number;
	}[] = [];
	bridged: { callControlId: string; targetCallControlId: string; commandId: string }[] = [];
	hungup: { callControlId: string; commandId: string }[] = [];
	rejected: { callControlId: string; commandId: string }[] = [];
	spoken: { callControlId: string; commandId: string; text: string }[] = [];
	nextDialCallControlId = 'cc-outbound';

	async answerCall(input: { callControlId: string; commandId: string }): Promise<void> {
		this.answered.push(input);
	}

	async dialCall(input: {
		callControlId: string;
		to: string;
		from: string;
		commandId: string;
		timeoutSeconds: number;
	}): Promise<{ callControlId: string }> {
		this.dialed.push(input);
		return { callControlId: this.nextDialCallControlId };
	}

	async bridgeCalls(input: {
		callControlId: string;
		targetCallControlId: string;
		commandId: string;
	}): Promise<void> {
		this.bridged.push(input);
	}

	async hangupCall(input: { callControlId: string; commandId: string }): Promise<void> {
		this.hungup.push(input);
	}

	async rejectCall(input: { callControlId: string; commandId: string }): Promise<void> {
		this.rejected.push(input);
	}

	async speakCall(input: { callControlId: string; commandId: string; text: string }): Promise<void> {
		this.spoken.push(input);
	}

	verifyWebhook(rawBody: string, signature: string | null): boolean {
		void rawBody;
		return signature === FAKE_WEBHOOK_SIGNATURE;
	}

	parseWebhook(payload: unknown): NormalizedVoiceWebhookEvent | null {
		return TelnyxVoiceProvider.prototype.parseWebhook.call(this, payload);
	}
}
