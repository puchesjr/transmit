import type { NormalizedVoiceWebhookEvent, VoiceProvider } from './voice';
import { verifyTelnyxWebhook } from './telnyx-webhook';

const API = 'https://api.telnyx.com/v2';
const AMD_ANALYSIS_MS = 4000;

type TelnyxVoiceWebhook = {
	data?: {
		id?: string;
		event_type?: string;
		occurred_at?: string;
		payload?: {
			call_control_id?: string;
			call_session_id?: string;
			call_leg_id?: string;
			direction?: string;
			from?: string;
			to?: string;
			occurred_at?: string;
			start_time?: string;
			end_time?: string;
			hangup_cause?: string;
			result?: string;
		};
	};
};

type TelnyxDialResponse = {
	data?: {
		call_control_id?: string;
	};
};

export class TelnyxVoiceProvider implements VoiceProvider {
	private apiKey(): string {
		const key = process.env.TELNYX_API_KEY;
		if (!key) throw new Error('TELNYX_API_KEY is not set');
		return key;
	}

	private connectionId(): string {
		const id = process.env.TELNYX_VOICE_CONNECTION_ID;
		if (!id) throw new Error('TELNYX_VOICE_CONNECTION_ID is not set');
		return id;
	}

	private async command(
		callControlId: string,
		action: string,
		body: unknown,
		options?: { ignoreEnded?: boolean }
	): Promise<void> {
		const response = await fetch(
			`${API}/calls/${encodeURIComponent(callControlId)}/actions/${action}`,
			{
				method: 'POST',
				headers: {
					authorization: `Bearer ${this.apiKey()}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify(body)
			}
		);
		if (!response.ok) {
			if (options?.ignoreEnded && response.status === 422) return;
			const text = await response.text().catch(() => '');
			throw new Error(`telnyx voice ${action} failed (${response.status}): ${text.slice(0, 300)}`);
		}
	}

	answerCall(input: { callControlId: string; commandId: string }): Promise<void> {
		return this.command(input.callControlId, 'answer', { command_id: input.commandId });
	}

	async dialCall(input: {
		callControlId: string;
		to: string;
		from: string;
		commandId: string;
		timeoutSeconds: number;
	}): Promise<{ callControlId: string }> {
		const response = await fetch(`${API}/calls`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${this.apiKey()}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				connection_id: this.connectionId(),
				to: input.to,
				from: input.from,
				timeout_secs: input.timeoutSeconds,
				link_to: input.callControlId,
				bridge_on_answer: false,
				answering_machine_detection: 'premium',
				answering_machine_detection_config: {
					total_analysis_time_millis: AMD_ANALYSIS_MS
				},
				command_id: input.commandId
			})
		});
		const text = await response.text().catch(() => '');
		if (!response.ok) {
			throw new Error(`telnyx voice dial failed (${response.status}): ${text.slice(0, 300)}`);
		}
		let parsed: TelnyxDialResponse;
		try {
			parsed = JSON.parse(text) as TelnyxDialResponse;
		} catch {
			throw new Error('telnyx voice dial returned invalid json');
		}
		const callControlId = parsed.data?.call_control_id;
		if (!callControlId) throw new Error('telnyx voice dial did not return call_control_id');
		return { callControlId };
	}

	bridgeCalls(input: {
		callControlId: string;
		targetCallControlId: string;
		commandId: string;
	}): Promise<void> {
		return this.command(input.callControlId, 'bridge', {
			call_control_id: input.targetCallControlId,
			command_id: input.commandId
		});
	}

	hangupCall(input: { callControlId: string; commandId: string }): Promise<void> {
		return this.command(
			input.callControlId,
			'hangup',
			{ command_id: input.commandId },
			{ ignoreEnded: true }
		);
	}

	rejectCall(input: { callControlId: string; commandId: string }): Promise<void> {
		return this.command(
			input.callControlId,
			'reject',
			{
				cause: 'CALL_REJECTED',
				command_id: input.commandId
			},
			{ ignoreEnded: true }
		);
	}

	speakCall(input: { callControlId: string; commandId: string; text: string }): Promise<void> {
		return this.command(input.callControlId, 'speak', {
			command_id: input.commandId,
			payload: input.text,
			payload_type: 'text',
			voice: 'female',
			language: 'en-US',
			service_level: 'basic'
		});
	}

	verifyWebhook(rawBody: string, signature: string | null, timestamp: string | null): boolean {
		return verifyTelnyxWebhook(rawBody, signature, timestamp);
	}

	parseWebhook(payload: unknown): NormalizedVoiceWebhookEvent | null {
		const event = payload as TelnyxVoiceWebhook;
		const data = event?.data;
		const inner = data?.payload;
		if (!data?.id || !data.event_type || !inner?.call_control_id || !inner.call_session_id) {
			return null;
		}

		const types = {
			'call.initiated': 'initiated',
			'call.answered': 'answered',
			'call.bridged': 'bridged',
			'call.hangup': 'hangup',
			'call.machine.premium.detection.ended': 'machine_detection',
			'call.machine.detection.ended': 'machine_detection',
			'call.speak.ended': 'speak_ended'
		} as const;
		const type = types[data.event_type as keyof typeof types];
		if (!type) return null;
		// speak.ended omits from/to; every other event needs caller identity.
		if (type !== 'speak_ended' && (!inner.call_leg_id || !inner.from || !inner.to)) {
			return null;
		}

		return {
			type,
			eventId: data.id,
			callControlId: inner.call_control_id,
			callSessionId: inner.call_session_id,
			callLegId: inner.call_leg_id ?? '',
			direction:
				inner.direction === 'incoming' || inner.direction === 'outgoing'
					? inner.direction
					: null,
			from: inner.from ?? '',
			to: inner.to ?? '',
			occurredAt: inner.occurred_at ?? data.occurred_at ?? new Date().toISOString(),
			startTime: inner.start_time ?? null,
			endTime: inner.end_time ?? null,
			hangupCause: inner.hangup_cause ?? null,
			machineDetectionResult: type === 'machine_detection' ? (inner.result ?? null) : null
		};
	}
}
