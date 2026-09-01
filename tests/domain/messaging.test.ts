import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import {
	getConversationThread,
	getContactMessageThread,
	listAccountConversations,
	provisionNumber,
	quietHoursDeferral,
	sendSms,
	submitMessagingRegistration
} from '$lib/server/domain/messaging';
import { handleTelnyxWebhook } from '$lib/server/domain/webhooks';
import { createContact } from '$lib/server/domain/contacts';
import { AppError } from '$lib/server/errors';
import { drainOutbox } from '$lib/server/outbox';
import {
	FakeMessagingProvider,
	FakeVoiceProvider,
	FAKE_WEBHOOK_SIGNATURE
} from '$lib/server/providers/fake';
import { updateContactConsent } from '$lib/server/repos/contacts';
import { updateLocationQuietHours } from '$lib/server/repos/locations';
import { outboxHandlers } from '$lib/server/worker';
import type { AuthContext } from '$lib/server/context';
import { authContext, createWorkspace } from '../helpers';
import { activateTestBilling } from '../helpers';
import { FakeBillingProvider } from '$lib/server/providers/fake-billing';
import { FakeAiProvider } from '$lib/server/providers/fake-ai';
import { FakeOutboundWebhookProvider } from '$lib/server/providers/fake-outbound-webhook';

let numberSeq = 0;

async function setupMessaging(prefix: string): Promise<{
	ctx: AuthContext;
	provider: FakeMessagingProvider;
	numberE164: string;
}> {
	const sql = getSql();
	const provider = new FakeMessagingProvider();
	const workspace = await createWorkspace(prefix);
	const ctx = authContext(workspace);
	await activateTestBilling(workspace);
	await submitMessagingRegistration(sql, provider, ctx, {
		legalName: 'Test Co',
		ein: null,
		website: null,
		address: '1 Main St, Austin TX',
		contactEmail: 'owner@test.co',
		useCase: 'Customer service',
		sampleMessage: 'Hi, reply STOP to opt out.'
	});
	numberSeq += 1;
	const number = await provisionNumber(
		sql,
		provider,
		ctx,
		`+1512555${String(1000 + numberSeq).slice(-4)}`
	);
	return { ctx, provider, numberE164: number.e164 };
}

function inboundPayload(eventId: string, messageId: string, from: string, to: string, text: string) {
	return JSON.stringify({
		data: {
			id: eventId,
			event_type: 'message.received',
			payload: { id: messageId, from: { phone_number: from }, to: [{ phone_number: to }], text }
		}
	});
}

async function drain(provider: FakeMessagingProvider): Promise<number> {
	return drainOutbox(
		getSql(),
		{
			messaging: provider,
			voice: new FakeVoiceProvider(),
			billing: new FakeBillingProvider(),
			ai: new FakeAiProvider(),
			webhook: new FakeOutboundWebhookProvider()
		},
		outboxHandlers
	);
}

describe('outbound sms', () => {
	it('queues, sends via the worker, and logs an activity', async () => {
		const sql = getSql();
		const { ctx, provider, numberE164 } = await setupMessaging('sms-send');
		const contact = await createContact(sql, ctx, {
			firstName: 'Grace',
			lastName: 'Hopper',
			email: null,
			phone: '(512) 555-0142'
		});

		const message = await sendSms(sql, ctx, contact.id, 'Hello Grace');
		expect(message.status).toBe('queued');

		await drain(provider);

		const thread = await getConversationThread(sql, ctx, message.conversationId);
		expect(thread.messages).toHaveLength(1);
		expect(thread.messages[0].status).toBe('sent');
		expect(provider.sent).toHaveLength(1);
		expect(provider.sent[0].to).toBe('+15125550142');
		expect(provider.sent[0].from).toBe(numberE164);
	});

	it('reuses one durable conversation for repeated messages to the same customer', async () => {
		const sql = getSql();
		const { ctx } = await setupMessaging('sms-conversation');
		const contact = await createContact(sql, ctx, {
			firstName: 'Repeat',
			lastName: 'Customer',
			email: null,
			phone: '5125550198'
		});

		const first = await sendSms(sql, ctx, contact.id, 'First message');
		const second = await sendSms(sql, ctx, contact.id, 'Second message');

		expect(second.conversationId).toBe(first.conversationId);
		const conversations = await listAccountConversations(sql, ctx);
		expect(conversations).toHaveLength(1);
		expect(conversations[0].id).toBe(first.conversationId);
		const thread = await getConversationThread(sql, ctx, first.conversationId);
		expect(thread.messages.map((message) => message.body)).toEqual([
			'First message',
			'Second message'
		]);
	});

	it('refuses to send to an opted-out contact', async () => {
		const sql = getSql();
		const { ctx } = await setupMessaging('sms-optout');
		const contact = await createContact(sql, ctx, {
			firstName: 'Opted',
			lastName: 'Out',
			email: null,
			phone: '5125550001'
		});
		await updateContactConsent(sql, ctx.accountId, contact.id, 'opted_out');

		await expect(sendSms(sql, ctx, contact.id, 'hi')).rejects.toMatchObject({
			code: 'validation'
		} satisfies Partial<AppError>);
	});

	it('defers sends during quiet hours and the worker leaves them queued', async () => {
		const sql = getSql();
		const { ctx, provider } = await setupMessaging('sms-quiet');
		await updateLocationQuietHours(sql, ctx.accountId, ctx.locationId, {
			timezone: 'UTC',
			quietStart: '00:00',
			quietEnd: '23:59'
		});
		const contact = await createContact(sql, ctx, {
			firstName: 'Night',
			lastName: 'Owl',
			email: null,
			phone: '5125550002'
		});

		const message = await sendSms(sql, ctx, contact.id, 'good evening');
		expect(message.notBefore).not.toBeNull();

		await drain(provider);
		const thread = await getConversationThread(sql, ctx, message.conversationId);
		expect(thread.messages[0].status).toBe('queued');
		expect(provider.sent).toHaveLength(0);
	});

	it('computes quiet-hour deferrals across midnight windows', () => {
		const location = { timezone: 'UTC', quiet_start: '21:00', quiet_end: '08:00' };
		const night = new Date('2026-01-15T23:30:00Z');
		const deferred = quietHoursDeferral(location, night);
		expect(deferred?.toISOString()).toBe('2026-01-16T08:00:00.000Z');

		const day = new Date('2026-01-15T12:00:00Z');
		expect(quietHoursDeferral(location, day)).toBeNull();
	});
});

describe('inbound sms', () => {
	it('creates a contact, records the message, and shows up unread in conversations', async () => {
		const sql = getSql();
		const { ctx, provider, numberE164 } = await setupMessaging('sms-in');

		const result = await handleTelnyxWebhook(
			sql,
			provider,
			new FakeVoiceProvider(),
			inboundPayload('evt-1-' + ctx.accountId, 'pm-1-' + ctx.accountId, '+15125559999', numberE164, 'Do you do quotes?'),
			FAKE_WEBHOOK_SIGNATURE,
			'0'
		);
		expect(result).toEqual({ accepted: true, duplicate: false });
		await drain(provider);

		const conversations = await listAccountConversations(sql, ctx);
		expect(conversations).toHaveLength(1);
		expect(conversations[0].lastBody).toBe('Do you do quotes?');
		expect(conversations[0].unread).toBe(1);
		expect(conversations[0].phone).toBe('+15125559999');
	});

	it('ignores replayed webhook events', async () => {
		const sql = getSql();
		const { ctx, provider, numberE164 } = await setupMessaging('sms-replay');
		const payload = inboundPayload(
			'evt-replay-' + ctx.accountId,
			'pm-replay-' + ctx.accountId,
			'+15125558888',
			numberE164,
			'hello'
		);

		const voice = new FakeVoiceProvider();
		const first = await handleTelnyxWebhook(sql, provider, voice, payload, FAKE_WEBHOOK_SIGNATURE, '0');
		const second = await handleTelnyxWebhook(sql, provider, voice, payload, FAKE_WEBHOOK_SIGNATURE, '0');
		expect(first.duplicate).toBe(false);
		expect(second.duplicate).toBe(true);

		await drain(provider);
		const conversations = await listAccountConversations(sql, ctx);
		expect(conversations).toHaveLength(1);
		expect(conversations[0].unread).toBe(1);
	});

	it('rejects a bad webhook signature', async () => {
		const sql = getSql();
		const { provider, numberE164 } = await setupMessaging('sms-badsig');
		await expect(
			handleTelnyxWebhook(
				sql,
				provider,
				new FakeVoiceProvider(),
				inboundPayload('evt-bad', 'pm-bad', '+15125557777', numberE164, 'hi'),
				'wrong-signature',
				'0'
			)
		).rejects.toMatchObject({ code: 'unauthorized' } satisfies Partial<AppError>);
	});

	it('STOP opts the contact out and blocks further sends', async () => {
		const sql = getSql();
		const { ctx, provider, numberE164 } = await setupMessaging('sms-stop');
		const contact = await createContact(sql, ctx, {
			firstName: 'Stop',
			lastName: 'Please',
			email: null,
			phone: '+15125556666'
		});

		await handleTelnyxWebhook(
			sql,
			provider,
			new FakeVoiceProvider(),
			inboundPayload('evt-stop-' + ctx.accountId, 'pm-stop-' + ctx.accountId, '+15125556666', numberE164, 'STOP'),
			FAKE_WEBHOOK_SIGNATURE,
			'0'
		);
		await drain(provider);

		const thread = await getContactMessageThread(sql, ctx, contact.id);
		expect(thread.contact.messagingConsent).toBe('opted_out');
		await expect(sendSms(sql, ctx, contact.id, 'still there?')).rejects.toMatchObject({
			code: 'validation'
		} satisfies Partial<AppError>);
	});
});

describe('tenant isolation', () => {
	it('cannot message or read another account contact', async () => {
		const sql = getSql();
		const alpha = await setupMessaging('sms-iso-a');
		const beta = await setupMessaging('sms-iso-b');
		const contact = await createContact(sql, alpha.ctx, {
			firstName: 'Alpha',
			lastName: 'Only',
			email: null,
			phone: '5125550003'
		});
		const message = await sendSms(sql, alpha.ctx, contact.id, 'internal note');

		await expect(sendSms(sql, beta.ctx, contact.id, 'hi')).rejects.toMatchObject({
			code: 'not_found'
		} satisfies Partial<AppError>);
		await expect(getConversationThread(sql, beta.ctx, message.conversationId)).rejects.toMatchObject({
			code: 'not_found'
		} satisfies Partial<AppError>);
		expect(await listAccountConversations(sql, beta.ctx)).toEqual([]);
	});
});
