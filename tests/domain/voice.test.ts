import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import { createContact, getContactTimeline, listAccountContacts } from '$lib/server/domain/contacts';
import {
	getContactMessageThread,
	provisionNumber,
	submitMessagingRegistration
} from '$lib/server/domain/messaging';
import { handleTelnyxWebhook } from '$lib/server/domain/webhooks';
import {
	getVoiceSettings,
	isWithinBusinessHours,
	listAccountCalls,
	saveVoiceSettings
} from '$lib/server/domain/voice';
import { drainOutbox } from '$lib/server/outbox';
import {
	FakeMessagingProvider,
	FakeVoiceProvider,
	FAKE_WEBHOOK_SIGNATURE
} from '$lib/server/providers/fake';
import { updateContactConsent } from '$lib/server/repos/contacts';
import { updateLocationQuietHours } from '$lib/server/repos/locations';
import { outboxHandlers } from '$lib/server/worker';
import { FakeAiProvider } from '$lib/server/providers/fake-ai';
import type { BusinessHours } from '$lib/types';
import type { AuthContext } from '$lib/server/context';
import { authContext, createWorkspace } from '../helpers';
import { activateTestBilling } from '../helpers';
import { FakeBillingProvider } from '$lib/server/providers/fake-billing';
import { FakeOutboundWebhookProvider } from '$lib/server/providers/fake-outbound-webhook';

let numberSeq = 3000;

const OPEN_HOURS: BusinessHours = {
	mon: { enabled: true, opensAt: '00:00', closesAt: '23:59' },
	tue: { enabled: true, opensAt: '00:00', closesAt: '23:59' },
	wed: { enabled: true, opensAt: '00:00', closesAt: '23:59' },
	thu: { enabled: true, opensAt: '00:00', closesAt: '23:59' },
	fri: { enabled: true, opensAt: '00:00', closesAt: '23:59' },
	sat: { enabled: true, opensAt: '00:00', closesAt: '23:59' },
	sun: { enabled: true, opensAt: '00:00', closesAt: '23:59' }
};
const CLOSED_HOURS: BusinessHours = Object.fromEntries(
	Object.entries(OPEN_HOURS).map(([day, hours]) => [day, { ...hours, enabled: false }])
) as BusinessHours;

async function setupVoice(prefix: string, businessHours = OPEN_HOURS) {
	const sql = getSql();
	const messaging = new FakeMessagingProvider();
	const voice = new FakeVoiceProvider();
	const workspace = await createWorkspace(prefix);
	const ctx: AuthContext = authContext(workspace);
	const billing = await activateTestBilling(workspace);
	await submitMessagingRegistration(sql, messaging, ctx, {
		legalName: 'Voice Test LLC',
		ein: null,
		website: null,
		address: '1 Main St, Austin TX',
		contactEmail: 'owner@voice.test',
		useCase: 'Customer service',
		sampleMessage: 'Thanks for calling. Reply STOP to opt out.'
	});
	numberSeq += 1;
	const number = await provisionNumber(sql, messaging, ctx, `+1512555${numberSeq}`);
	await saveVoiceSettings(sql, ctx, {
		timezone: 'UTC',
		forwardingNumber: '+15125550100',
		missedCallTextbackEnabled: true,
		missedCallTemplate: 'Sorry we missed your call — how can we help? Reply STOP to opt out.',
		businessHours
	});
	return { sql, messaging, voice, billing, ctx, number };
}

function voicePayload(input: {
	eventId: string;
	type: 'call.initiated' | 'call.answered' | 'call.bridged' | 'call.hangup';
	callControlId?: string;
	callSessionId?: string;
	direction?: 'incoming' | 'outgoing';
	from: string;
	to: string;
	occurredAt: string;
	startTime?: string;
	endTime?: string;
	hangupCause?: string;
}) {
	return JSON.stringify({
		data: {
			id: input.eventId,
			event_type: input.type,
			occurred_at: input.occurredAt,
			payload: {
				call_control_id: input.callControlId ?? 'cc-inbound',
				call_session_id: input.callSessionId ?? 'session-1',
				call_leg_id: `${input.callControlId ?? 'cc-inbound'}-leg`,
				direction: input.direction ?? 'incoming',
				from: input.from,
				to: input.to,
				occurred_at: input.occurredAt,
				start_time: input.startTime,
				end_time: input.endTime,
				hangup_cause: input.hangupCause
			}
		}
	});
}

async function acceptAndDrain(
	setup: Awaited<ReturnType<typeof setupVoice>>,
	payload: string
) {
	await handleTelnyxWebhook(
		setup.sql,
		setup.messaging,
		setup.voice,
		payload,
		FAKE_WEBHOOK_SIGNATURE,
		'0'
	);
	return drainOutbox(
		setup.sql,
		{ messaging: setup.messaging, voice: setup.voice, billing: setup.billing, ai: new FakeAiProvider(), webhook: new FakeOutboundWebhookProvider() },
		outboxHandlers
	);
}

describe('voice business hours', () => {
	it('evaluates the configured location schedule in its timezone', () => {
		expect(
			isWithinBusinessHours(
				{ timezone: 'America/Chicago', business_hours: OPEN_HOURS },
				new Date('2026-08-31T17:00:00Z')
			)
		).toBe(true);
		expect(
			isWithinBusinessHours(
				{ timezone: 'America/Chicago', business_hours: CLOSED_HOURS },
				new Date('2026-08-31T17:00:00Z')
			)
		).toBe(false);
	});

	it('saves settings only for the authenticated location', async () => {
		const setup = await setupVoice('voice-settings');
		const settings = await getVoiceSettings(setup.sql, setup.ctx);
		expect(settings.forwardingNumber).toBe('+15125550100');
		expect(settings.businessHours.mon.enabled).toBe(true);
	});
});

describe('inbound call routing', () => {
	it('answers during business hours, transfers, and records completed duration', async () => {
		const setup = await setupVoice('voice-forward');
		const caller = '+15125550901';
		const start = '2026-08-31T12:00:00.000Z';
		await acceptAndDrain(
			setup,
			voicePayload({ eventId: 'voice-init-forward', type: 'call.initiated', from: caller, to: setup.number.e164, occurredAt: start, startTime: start })
		);
		expect(setup.voice.answered).toHaveLength(1);

		await acceptAndDrain(
			setup,
			voicePayload({ eventId: 'voice-answer-forward', type: 'call.answered', from: caller, to: setup.number.e164, occurredAt: '2026-08-31T12:00:02.000Z', startTime: start })
		);
		expect(setup.voice.transferred[0]).toMatchObject({
			to: '+15125550100',
			from: setup.number.e164,
			timeoutSeconds: 25
		});

		await acceptAndDrain(
			setup,
			voicePayload({ eventId: 'voice-bridge-forward', type: 'call.bridged', callControlId: 'cc-outbound', direction: 'outgoing', from: setup.number.e164, to: '+15125550100', occurredAt: '2026-08-31T12:00:05.000Z', startTime: start })
		);
		await acceptAndDrain(
			setup,
			voicePayload({ eventId: 'voice-hangup-forward', type: 'call.hangup', from: caller, to: setup.number.e164, occurredAt: '2026-08-31T12:01:05.000Z', startTime: start, endTime: '2026-08-31T12:01:05.000Z', hangupCause: 'normal_clearing' })
		);

		const calls = await listAccountCalls(setup.sql, setup.ctx);
		expect(calls[0]).toMatchObject({ status: 'completed', durationSeconds: 65 });
		const timeline = await getContactTimeline(setup.sql, setup.ctx, calls[0].contactId);
		expect(timeline.some((activity) => activity.type === 'call.completed')).toBe(true);
		expect(setup.messaging.sent).toHaveLength(0);
	});

	it('turns an after-hours call into a customer, call activity, and automatic SMS', async () => {
		const setup = await setupVoice('voice-missed', CLOSED_HOURS);
		const caller = '+15125550902';
		const payload = voicePayload({
			eventId: 'voice-init-missed',
			type: 'call.initiated',
			from: caller,
			to: setup.number.e164,
			occurredAt: '2026-08-31T12:00:00.000Z'
		});
		const first = await handleTelnyxWebhook(
			setup.sql,
			setup.messaging,
			setup.voice,
			payload,
			FAKE_WEBHOOK_SIGNATURE,
			'0'
		);
		const replay = await handleTelnyxWebhook(
			setup.sql,
			setup.messaging,
			setup.voice,
			payload,
			FAKE_WEBHOOK_SIGNATURE,
			'0'
		);
		expect(first.duplicate).toBe(false);
		expect(replay.duplicate).toBe(true);
		await drainOutbox(
			setup.sql,
			{ messaging: setup.messaging, voice: setup.voice, billing: setup.billing, ai: new FakeAiProvider(), webhook: new FakeOutboundWebhookProvider() },
			outboxHandlers
		);

		expect(setup.voice.rejected).toHaveLength(1);
		expect(setup.messaging.sent).toHaveLength(1);
		expect(setup.messaging.sent[0]).toMatchObject({ to: caller });
		const contacts = await listAccountContacts(setup.sql, setup.ctx);
		expect(contacts).toHaveLength(1);
		const calls = await listAccountCalls(setup.sql, setup.ctx);
		expect(calls[0]).toMatchObject({ status: 'missed', afterHours: true });
		expect(calls[0].textbackMessageId).toBeTruthy();
		const thread = await getContactMessageThread(setup.sql, setup.ctx, contacts[0].id);
		expect(thread.messages[0].body).toContain('Sorry we missed your call');
		expect(thread.messages[0].status).toBe('sent');
		const timeline = await getContactTimeline(setup.sql, setup.ctx, contacts[0].id);
		expect(timeline.some((activity) => activity.type === 'call.missed')).toBe(true);
	});

	it('recovers an out-of-order inbound hangup without sending twice', async () => {
		const setup = await setupVoice('voice-order', OPEN_HOURS);
		const caller = '+15125550903';
		const session = 'session-out-of-order';
		await acceptAndDrain(
			setup,
			voicePayload({ eventId: 'voice-hangup-first', type: 'call.hangup', callSessionId: session, from: caller, to: setup.number.e164, occurredAt: '2026-08-31T12:00:20.000Z', startTime: '2026-08-31T12:00:00.000Z', endTime: '2026-08-31T12:00:20.000Z', hangupCause: 'timeout' })
		);
		await acceptAndDrain(
			setup,
			voicePayload({ eventId: 'voice-init-late', type: 'call.initiated', callSessionId: session, from: caller, to: setup.number.e164, occurredAt: '2026-08-31T12:00:00.000Z', startTime: '2026-08-31T12:00:00.000Z' })
		);
		expect((await listAccountCalls(setup.sql, setup.ctx))).toHaveLength(1);
		expect(setup.messaging.sent).toHaveLength(1);
		expect(setup.voice.answered).toHaveLength(0);
	});

	it('never texts an opted-out caller and defers textback during quiet hours', async () => {
		const optedOut = await setupVoice('voice-optout', CLOSED_HOURS);
		const caller = '+15125550904';
		const existing = await createContact(optedOut.sql, optedOut.ctx, {
			firstName: 'No', lastName: 'Texts', email: null, phone: caller
		});
		await updateContactConsent(optedOut.sql, optedOut.ctx.accountId, existing.id, 'opted_out');
		await acceptAndDrain(
			optedOut,
			voicePayload({ eventId: 'voice-optout-init', type: 'call.initiated', from: caller, to: optedOut.number.e164, occurredAt: '2026-08-31T12:00:00.000Z' })
		);
		expect(optedOut.messaging.sent).toHaveLength(0);

		const deferred = await setupVoice('voice-quiet', CLOSED_HOURS);
		await updateLocationQuietHours(deferred.sql, deferred.ctx.accountId, deferred.ctx.locationId, {
			timezone: 'UTC', quietStart: '00:00', quietEnd: '23:59'
		});
		await acceptAndDrain(
			deferred,
			voicePayload({ eventId: 'voice-quiet-init', type: 'call.initiated', from: '+15125550905', to: deferred.number.e164, occurredAt: new Date().toISOString() })
		);
		expect(deferred.messaging.sent).toHaveLength(0);
		const customer = (await listAccountContacts(deferred.sql, deferred.ctx))[0];
		const thread = await getContactMessageThread(deferred.sql, deferred.ctx, customer.id);
		expect(thread.messages[0].status).toBe('queued');
		expect(thread.messages[0].notBefore).not.toBeNull();
	});
});
