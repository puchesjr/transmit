import type { NormalizedVoiceWebhookEvent, VoiceProvider } from './voice';
import { verifyTelnyxWebhook } from './telnyx-webhook';

const API = 'https://api.telnyx.com/v2';

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
		};
	};
};

export class TelnyxVoiceProvider implements VoiceProvider {
	private apiKey(): string {
		const key = process.env.TELNYX_API_KEY;
		if (!key) throw new Error('TELNYX_API_KEY is not set');
		return key;
	}

	private async command(callControlId: string, action: string, body: unknown): Promise<void> {
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
			const text = await response.text().catch(() => '');
			throw new Error(`telnyx voice ${action} failed (${response.status}): ${text.slice(0, 300)}`);
		}
	}

	answerCall(input: { callControlId: string; commandId: string }): Promise<void> {
		return this.command(input.callControlId, 'answer', { command_id: input.commandId });
	}

	transferCall(input: {
		callControlId: string;
		to: string;
		from: string;
		commandId: string;
		timeoutSeconds: number;
	}): Promise<void> {
		return this.command(input.callControlId, 'transfer', {
			to: input.to,
			from: input.from,
			timeout_secs: input.timeoutSeconds,
			command_id: input.commandId
		});
	}

	rejectCall(input: { callControlId: string; commandId: string }): Promise<void> {
		return this.command(input.callControlId, 'reject', {
			cause: 'CALL_REJECTED',
			command_id: input.commandId
		});
	}

	verifyWebhook(rawBody: string, signature: string | null, timestamp: string | null): boolean {
		return verifyTelnyxWebhook(rawBody, signature, timestamp);
	}

	parseWebhook(payload: unknown): NormalizedVoiceWebhookEvent | null {
		const event = payload as TelnyxVoiceWebhook;
		const data = event?.data;
		const inner = data?.payload;
		if (
			!data?.id ||
			!data.event_type ||
			!inner?.call_control_id ||
			!inner.call_session_id ||
			!inner.call_leg_id ||
			!inner.from ||
			!inner.to
		) {
			return null;
		}

		const types = {
			'call.initiated': 'initiated',
			'call.answered': 'answered',
			'call.bridged': 'bridged',
			'call.hangup': 'hangup'
		} as const;
		const type = types[data.event_type as keyof typeof types];
		if (!type) return null;

		return {
			type,
			eventId: data.id,
			callControlId: inner.call_control_id,
			callSessionId: inner.call_session_id,
			callLegId: inner.call_leg_id,
			direction:
				inner.direction === 'incoming' || inner.direction === 'outgoing'
					? inner.direction
					: null,
			from: inner.from,
			to: inner.to,
			occurredAt: inner.occurred_at ?? data.occurred_at ?? new Date().toISOString(),
			startTime: inner.start_time ?? null,
			endTime: inner.end_time ?? null,
			hangupCause: inner.hangup_cause ?? null
		};
	}
}
