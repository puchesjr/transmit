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
	MISSED_CALL_PROMPT,
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
import { authContext, createWorkspace, registrationInput } from '../helpers';
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
	await submitMessagingRegistration(
		sql,
		messaging,
		ctx,
		registrationInput({
			legalName: 'Voice Test LLC',
			contactEmail: 'owner@voice.test',
			sampleMessage: 'Thanks for calling. Reply STOP to opt out.'
		})
	);
	numberSeq += 1;
	const number = await provisionNumber(sql, messaging, ctx, `+1512555${numberSeq}`);
	await drainOutbox(
		sql,
		{ messaging, voice, billing, ai: new FakeAiProvider(), webhook: new FakeOutboundWebhookProvider() },
		outboxHandlers
	);
	await saveVoiceSettings(sql, ctx, {
		timezone: 'UTC',
		forwardingNumber: '+15125550100',
		missedCallTextbackEnabled: true,
		missedCallTemplate: 'Sorry we missed your call. How can we help? Reply STOP to opt out.',
		businessHours
	});
	return { sql, messaging, voice, billing, ctx, number };
}

describe('voice settings authorization', () => {
	it('lets only the owner change forwarding', async () => {
		const setup = await setupVoice('voice-owner');
		const member = { ...setup.ctx, role: 'member' as const };
		await expect(
			saveVoiceSettings(setup.sql, member, {
				timezone: 'UTC',
				forwardingNumber: '+15125550999',
				missedCallTextbackEnabled: true,
				missedCallTemplate: 'Sorry we missed your call. Reply STOP to opt out.',
				businessHours: OPEN_HOURS
			})
		).rejects.toMatchObject({ code: 'forbidden' });
	});
});

function voicePayload(input: {
	eventId: string;
	type:
		| 'call.initiated'
		| 'call.answered'
		| 'call.bridged'
		| 'call.hangup'
		| 'call.machine.premium.detection.ended'
		| 'call.speak.ended';
	callControlId?: string;
	callSessionId?: string;
	direction?: 'incoming' | 'outgoing';
	from: string;
	to: string;
	occurredAt: string;
	startTime?: string;
	endTime?: string;
	hangupCause?: string;
	result?: string;
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
				hangup_cause: input.hangupCause,
				result: input.result
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

function expectMissedCallPrompt(voice: FakeVoiceProvider, inboundId = 'cc-inbound') {
	expect(voice.rejected).toHaveLength(0);
	expect(voice.answered.some((row) => row.callControlId === inboundId)).toBe(true);
	expect(voice.spoken).toContainEqual(
		expect.objectContaining({ callControlId: inboundId, text: MISSED_CALL_PROMPT })
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
	it('dials during business hours, bridges after human AMD, and records completed duration', async () => {
		const setup = await setupVoice('voice-forward');
		const caller = '+15125550901';
		const start = '2026-08-31T12:00:00.000Z';
		await acceptAndDrain(
			setup,
			voicePayload({ eventId: 'voice-init-forward', type: 'call.initiated', from: caller, to: setup.number.e164, occurredAt: start, startTime: start })
		);
		expect(setup.voice.answered).toHaveLength(0);
		expect(setup.voice.dialed[0]).toMatchObject({
			callControlId: 'cc-inbound',
			to: '+15125550100',
			from: setup.number.e164,
			timeoutSeconds: 20
		});

		await acceptAndDrain(
			setup,
			voicePayload({
				eventId: 'voice-outbound-answered',
				type: 'call.answered',
				callControlId: 'cc-outbound',
				direction: 'outgoing',
				from: setup.number.e164,
				to: '+15125550100',
				occurredAt: '2026-08-31T12:00:04.000Z',
				startTime: start
			})
		);
		expect((await listAccountCalls(setup.sql, setup.ctx))[0].status).toBe('forwarding');
		expect(setup.messaging.sent).toHaveLength(0);

		await acceptAndDrain(
			setup,
			voicePayload({
				eventId: 'voice-amd-human',
				type: 'call.machine.premium.detection.ended',
				callControlId: 'cc-outbound',
				direction: 'outgoing',
				from: setup.number.e164,
				to: '+15125550100',
				occurredAt: '2026-08-31T12:00:06.000Z',
				startTime: start,
				result: 'human_residence'
			})
		);
		expect(setup.voice.answered[0]).toMatchObject({ callControlId: 'cc-inbound' });
		expect(setup.voice.spoken).toHaveLength(0);
		expect(setup.voice.bridged[0]).toMatchObject({
			callControlId: 'cc-inbound',
			targetCallControlId: 'cc-outbound'
		});

		await acceptAndDrain(
			setup,
			voicePayload({
				eventId: 'voice-bridge-forward',
				type: 'call.bridged',
				callControlId: 'cc-outbound',
				direction: 'outgoing',
				from: setup.number.e164,
				to: '+15125550100',
				occurredAt: '2026-08-31T12:00:07.000Z',
				startTime: start
			})
		);
		const hungupBefore = setup.voice.hungup.length;
		await acceptAndDrain(
			setup,
			voicePayload({
				eventId: 'voice-speak-ended-live',
				type: 'call.speak.ended',
				from: setup.number.e164,
				to: caller,
				occurredAt: '2026-08-31T12:00:08.000Z'
			})
		);
		expect(setup.voice.hungup).toHaveLength(hungupBefore);

		await acceptAndDrain(
			setup,
			voicePayload({
				eventId: 'voice-hangup-forward',
				type: 'call.hangup',
				from: caller,
				to: setup.number.e164,
				occurredAt: '2026-08-31T12:01:05.000Z',
				startTime: start,
				endTime: '2026-08-31T12:01:05.000Z',
				hangupCause: 'normal_clearing'
			})
		);

		const calls = await listAccountCalls(setup.sql, setup.ctx);
		expect(calls[0]).toMatchObject({ status: 'completed', durationSeconds: 65 });
		const timeline = await getContactTimeline(setup.sql, setup.ctx, calls[0].contactId);
		expect(timeline.some((activity) => activity.type === 'call.completed')).toBe(true);
		expect(setup.messaging.sent).toHaveLength(0);
		expect(setup.voice.spoken).toHaveLength(0);
	});

	it('treats carrier voicemail AMD as a missed call and texts the caller', async () => {
		const setup = await setupVoice('voice-amd-machine');
		const caller = '+15125550911';
		const start = '2026-08-31T12:00:00.000Z';
		await acceptAndDrain(
			setup,
			voicePayload({
				eventId: 'voice-init-vm',
				type: 'call.initiated',
				from: caller,
				to: setup.number.e164,
				occurredAt: start,
				startTime: start
			})
		);
		await acceptAndDrain(
			setup,
			voicePayload({
				eventId: 'voice-outbound-vm-answered',
				type: 'call.answered',
				callControlId: 'cc-outbound',
				direction: 'outgoing',
				from: setup.number.e164,
				to: '+15125550100',
				occurredAt: '2026-08-31T12:00:03.000Z',
				startTime: start
			})
		);
		await acceptAndDrain(
			setup,
			voicePayload({
				eventId: 'voice-amd-machine',
				type: 'call.machine.premium.detection.ended',
				callControlId: 'cc-outbound',
				callSessionId: 'session-outbound-leg',
				direction: 'outgoing',
				from: setup.number.e164,
				to: '+15125550100',
				occurredAt: '2026-08-31T12:00:06.000Z',
				startTime: start,
				result: 'machine'
			})
		);

		expect(setup.voice.hungup[0]).toMatchObject({ callControlId: 'cc-outbound' });
		expectMissedCallPrompt(setup.voice);
		expect(setup.voice.bridged).toHaveLength(0);
		const calls = await listAccountCalls(setup.sql, setup.ctx);
		expect(calls[0]).toMatchObject({ status: 'missed', hangupCause: 'voicemail' });
		expect(calls[0].textbackMessageId).toBeTruthy();
		expect(setup.messaging.sent).toHaveLength(1);
		expect(setup.messaging.sent[0]).toMatchObject({ to: caller });

		await acceptAndDrain(
			setup,
			JSON.stringify({
				data: {
					id: 'voice-speak-ended-vm',
					event_type: 'call.speak.ended',
					occurred_at: '2026-08-31T12:00:10.000Z',
					payload: {
						call_control_id: 'cc-inbound',
						call_session_id: 'session-1',
						call_leg_id: 'cc-inbound-leg',
						status: 'completed'
					}
				}
			})
		);
		expect(setup.voice.hungup.some((row) => row.callControlId === 'cc-inbound')).toBe(true);
	});

	it('treats an outbound timeout before AMD as missed and texts the caller', async () => {
		const setup = await setupVoice('voice-timeout');
		const caller = '+15125550912';
		const start = '2026-08-31T12:00:00.000Z';
		await acceptAndDrain(
			setup,
			voicePayload({
				eventId: 'voice-init-timeout',
				type: 'call.initiated',
				from: caller,
				to: setup.number.e164,
				occurredAt: start,
				startTime: start
			})
		);
		await acceptAndDrain(
			setup,
			voicePayload({
				eventId: 'voice-outbound-timeout',
				type: 'call.hangup',
				callControlId: 'cc-outbound',
				direction: 'outgoing',
				from: setup.number.e164,
				to: '+15125550100',
				occurredAt: '2026-08-31T12:00:20.000Z',
				startTime: start,
				endTime: '2026-08-31T12:00:20.000Z',
				hangupCause: 'timeout'
			})
		);

		expect(setup.voice.bridged).toHaveLength(0);
		expectMissedCallPrompt(setup.voice);
		const calls = await listAccountCalls(setup.sql, setup.ctx);
		expect(calls[0]).toMatchObject({ status: 'missed', hangupCause: 'timeout' });
		expect(setup.messaging.sent).toHaveLength(1);
	});

	it('treats not_sure AMD as voicemail and texts the caller', async () => {
		const setup = await setupVoice('voice-amd-unsure');
		const caller = '+15125550913';
		const start = '2026-08-31T12:00:00.000Z';
		await acceptAndDrain(
			setup,
			voicePayload({
				eventId: 'voice-init-unsure',
				type: 'call.initiated',
				from: caller,
				to: setup.number.e164,
				occurredAt: start,
				startTime: start
			})
		);
		await acceptAndDrain(
			setup,
			voicePayload({
				eventId: 'voice-amd-unsure',
				type: 'call.machine.premium.detection.ended',
				callControlId: 'cc-outbound',
				direction: 'outgoing',
				from: setup.number.e164,
				to: '+15125550100',
				occurredAt: '2026-08-31T12:00:06.000Z',
				startTime: start,
				result: 'not_sure'
			})
		);
		expect(setup.voice.bridged).toHaveLength(0);
		expectMissedCallPrompt(setup.voice);
		const calls = await listAccountCalls(setup.sql, setup.ctx);
		expect(calls[0]).toMatchObject({ status: 'missed', hangupCause: 'voicemail' });
		expect(setup.messaging.sent).toHaveLength(1);
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

		expectMissedCallPrompt(setup.voice);
		expect(setup.voice.dialed).toHaveLength(0);
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
		expectMissedCallPrompt(setup.voice);
		expect(setup.voice.dialed).toHaveLength(0);
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

it('records both final call legs, deduplicates by leg, and bills aggregated actual voice cost with rental',async()=>{
 const {sql,ctx,number,voice,billing,messaging}=await setupVoice('voice-cogs');
 const {createContact}=await import('$lib/server/domain/contacts');
 const {insertInboundCall,markCallForwarding}=await import('$lib/server/repos/calls');
 const {uuidv7}=await import('$lib/server/ids');
 const {processVoiceEvent}=await import('$lib/server/domain/voice');
 const {renewTelecomResource}=await import('$lib/server/domain/telecom');
 const contact=await createContact(sql,ctx,{firstName:'Cost',lastName:'Test',email:null,phone:'+15125552345'});
 const call=await insertInboundCall(sql,{id:uuidv7(),accountId:ctx.accountId,locationId:ctx.locationId,contactId:contact.id,
 phoneNumberId:number.id,providerCallSessionId:'cost-session',providerCallControlId:'cost-inbound',from:contact.phone!,to:number.e164,startedAt:new Date(),afterHours:false});
 await markCallForwarding(sql,ctx.accountId,call.id,'cost-outbound');
 await sql`update telecom_resources set created_at=now()-interval '2 minutes' where account_id=${ctx.accountId} and kind='number'`;
 for (const [leg,cost] of [['inbound','0.025123'],['outbound','0.032345']]) {
  const raw={data:{id:`evt-cost-${leg}`,event_type:'call.cost',occurred_at:new Date(Date.now()-60_000).toISOString(),payload:{status:'success',call_session_id:'cost-session',call_control_id:`cost-${leg}`,call_leg_id:`leg-${leg}`,
   total_cost:cost,billed_duration_secs:120,cost_parts:[{call_part:'sip-trunking',cost,currency:'USD'}]}}};
  const event=voice.parseWebhook(raw)!;
  expect(event.type).toBe('cost');
  await processVoiceEvent(sql,voice,{event});
  await processVoiceEvent(sql,voice,{event:{...event,eventId:`retry-${leg}`}});
 }
 const rows=await sql`select * from voice_costs where account_id=${ctx.accountId}`;
 expect(rows).toHaveLength(2);
 const [resource]=await sql`select * from telecom_resources where account_id=${ctx.accountId} and kind='number'`;
 const period=new Date(Date.now()-1);
 await sql`update telecom_resources set billed_until=${period} where account_id=${ctx.accountId} and id=${resource.id}`;
 const payload={accountId:ctx.accountId,resourceId:resource.id,period:period.toISOString()};
 await renewTelecomResource(sql,billing,payload);
 await renewTelecomResource(sql,billing,payload);
 expect(billing.telecomCharges.at(-1)?.amountCents).toBe(116); // $1.10 rental + $0.057468 rounded once
 const allocated=await sql`select * from voice_costs where account_id=${ctx.accountId} and charge_id is not null`;
 expect(allocated).toHaveLength(2);
 const unrelated=await createWorkspace('voice-cost-stranger');
 const {telecomSummary}=await import('$lib/server/domain/telecom');
 expect((await telecomSummary(sql,unrelated.account.id)).charges).toHaveLength(0);
 void messaging;
});
