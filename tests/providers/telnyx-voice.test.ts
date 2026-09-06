import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelnyxVoiceProvider } from '$lib/server/providers/telnyx-voice';

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('Telnyx voice provider', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('dials with session link, premium AMD, and no auto-bridge', async () => {
		vi.stubEnv('TELNYX_API_KEY', 'KEY');
		vi.stubEnv('TELNYX_VOICE_CONNECTION_ID', 'conn_1');
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			expect(String(url)).toBe('https://api.telnyx.com/v2/calls');
			expect(init?.method).toBe('POST');
			expect(JSON.parse(String(init?.body))).toEqual({
				connection_id: 'conn_1',
				to: '+15125550100',
				from: '+18325202171',
				timeout_secs: 20,
				link_to: 'cc-inbound',
				bridge_on_answer: false,
				answering_machine_detection: 'premium',
				answering_machine_detection_config: { total_analysis_time_millis: 4000 },
				command_id: 'cmd-1'
			});
			return jsonResponse(200, { data: { call_control_id: 'cc-outbound' } });
		});
		vi.stubGlobal('fetch', fetchMock);
		await expect(
			new TelnyxVoiceProvider().dialCall({
				callControlId: 'cc-inbound',
				to: '+15125550100',
				from: '+18325202171',
				commandId: 'cmd-1',
				timeoutSeconds: 20
			})
		).resolves.toEqual({ callControlId: 'cc-outbound' });
	});

	it('parses premium AMD results and ignores unknown voice events', () => {
		const provider = new TelnyxVoiceProvider();
		const parsed = provider.parseWebhook({
			data: {
				id: 'evt-amd',
				event_type: 'call.machine.premium.detection.ended',
				occurred_at: '2026-08-31T12:00:06.000Z',
				payload: {
					call_control_id: 'cc-outbound',
					call_session_id: 'session-1',
					call_leg_id: 'leg-b',
					direction: 'outgoing',
					from: '+18325202171',
					to: '+15125550100',
					occurred_at: '2026-08-31T12:00:06.000Z',
					result: 'machine'
				}
			}
		});
		expect(parsed).toMatchObject({
			type: 'machine_detection',
			callControlId: 'cc-outbound',
			machineDetectionResult: 'machine'
		});
		expect(
			provider.parseWebhook({
				data: {
					id: 'evt-other',
					event_type: 'call.dtmf.received',
					payload: {
						call_control_id: 'cc-outbound',
						call_session_id: 'session-1',
						call_leg_id: 'leg-b',
						from: '+18325202171',
						to: '+15125550100'
					}
				}
			})
		).toBeNull();
	});

	it('treats hangup of an already-ended call as success', async () => {
		vi.stubEnv('TELNYX_API_KEY', 'KEY');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse(422, { errors: [{ title: 'Call has already ended' }] }))
		);
		await expect(
			new TelnyxVoiceProvider().hangupCall({ callControlId: 'cc-outbound', commandId: 'cmd-1' })
		).resolves.toBeUndefined();
	});
});
