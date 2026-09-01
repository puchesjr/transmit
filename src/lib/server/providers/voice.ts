export type NormalizedVoiceWebhookEvent = {
	type: 'initiated' | 'answered' | 'bridged' | 'hangup';
	eventId: string;
	callControlId: string;
	callSessionId: string;
	callLegId: string;
	direction: 'incoming' | 'outgoing' | null;
	from: string;
	to: string;
	occurredAt: string;
	startTime: string | null;
	endTime: string | null;
	hangupCause: string | null;
};

export interface VoiceProvider {
	answerCall(input: { callControlId: string; commandId: string }): Promise<void>;
	transferCall(input: {
		callControlId: string;
		to: string;
		from: string;
		commandId: string;
		timeoutSeconds: number;
	}): Promise<void>;
	rejectCall(input: { callControlId: string; commandId: string }): Promise<void>;
	verifyWebhook(rawBody: string, signature: string | null, timestamp: string | null): boolean;
	parseWebhook(payload: unknown): NormalizedVoiceWebhookEvent | null;
}

let provider: VoiceProvider | undefined;

export async function getVoiceProvider(): Promise<VoiceProvider> {
	if (!provider) {
		const forced = process.env.VOICE_PROVIDER;
		if (forced === 'fake' || (!process.env.TELNYX_API_KEY && forced !== 'telnyx')) {
			const { FakeVoiceProvider } = await import('./fake');
			provider = new FakeVoiceProvider();
		} else {
			const { TelnyxVoiceProvider } = await import('./telnyx-voice');
			provider = new TelnyxVoiceProvider();
		}
	}
	return provider;
}

export function setVoiceProvider(override: VoiceProvider | undefined): void {
	provider = override;
}
