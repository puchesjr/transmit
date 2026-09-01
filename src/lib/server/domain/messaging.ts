import { contactName } from '$lib/format';
import type { Contact, Conversation, Message, MessagingRegistration, PhoneNumber } from '$lib/types';
import type { AuthContext } from '../context';
import type { Queryable, Sql } from '../db';
import { AppError } from '../errors';
import { uuidv7 } from '../ids';
import { log } from '../logger';
import { enqueue, RetryAt } from '../outbox';
import { normalizeE164 } from '../phone';
import type { MessagingProvider, NormalizedWebhookEvent } from '../providers/messaging';
import { insertActivity } from '../repos/activities';
import {
	findContactByPhone,
	getContact,
	insertContact,
	updateContactConsent
} from '../repos/contacts';
import {
	findOrCreateConversation,
	getConversation,
	getConversationSummary,
	listConversations,
	touchConversation
} from '../repos/conversations';
import { getLocation, type LocationRow } from '../repos/locations';
import {
	getMessageForSend,
	insertMessage,
	listMessagesForConversation,
	listMessagesForContact,
	markContactMessagesRead,
	markConversationRead,
	markMessageFailed,
	markMessageSent,
	updateMessageStatusByProviderId
} from '../repos/messages';
import {
	findNumberByE164,
	getActiveNumberForLocation,
	insertPhoneNumber,
	listPhoneNumbers
} from '../repos/phone-numbers';
import {
	getRegistration,
	insertRegistration,
	updateRegistrationStatus
} from '../repos/registrations';
import { asObject, optionalString, parseEmail, requiredString } from '../validation';
import {
	assertCanDispatchMessage,
	assertCanProvisionNumber,
	assertCanQueueMessage,
	recordUsage
} from './billing';
import { queueOutboundWebhookEvent } from './outbound-webhooks';

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_WORDS = new Set(['START', 'UNSTOP', 'YES']);
const HELP_REPLY =
	'Thanks for reaching out — reply here and we will get back to you. Reply STOP to opt out.';
const MAX_SMS_LENGTH = 1600;

// ---------- parsing ----------

export function parseSendMessage(body: unknown): { body: string } {
	const obj = asObject(body);
	return { body: requiredString(obj.body, 'body', MAX_SMS_LENGTH) };
}

export function parseSearchNumbers(body: unknown): { areaCode: string | null } {
	const obj = asObject(body);
	const areaCode = optionalString(obj.areaCode, 'areaCode', 3);
	if (areaCode && !/^\d{3}$/.test(areaCode)) {
		throw new AppError('validation', 'areaCode must be 3 digits');
	}
	return { areaCode };
}

export function parsePurchaseNumber(body: unknown): { e164: string } {
	const obj = asObject(body);
	const e164 = requiredString(obj.e164, 'e164', 20);
	if (!/^\+1\d{10}$/.test(e164)) {
		throw new AppError('validation', 'e164 must be a US number like +15551234567');
	}
	return { e164 };
}

export type RegistrationFormInput = {
	legalName: string;
	ein: string | null;
	website: string | null;
	address: string;
	contactEmail: string;
	useCase: string;
	sampleMessage: string;
};

export function parseRegistration(body: unknown): RegistrationFormInput {
	const obj = asObject(body);
	return {
		legalName: requiredString(obj.legalName, 'legalName', 200),
		ein: optionalString(obj.ein, 'ein', 20),
		website: optionalString(obj.website, 'website', 200),
		address: requiredString(obj.address, 'address', 300),
		contactEmail: parseEmail(obj.contactEmail),
		useCase: requiredString(obj.useCase, 'useCase', 500),
		sampleMessage: requiredString(obj.sampleMessage, 'sampleMessage', 500)
	};
}

// ---------- quiet hours ----------

function minutesInTimezone(now: Date, timezone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(now);
	const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0) % 24;
	const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
	return hour * 60 + minute;
}

function parseTime(value: string): number {
	const [hour = 0, minute = 0] = value.split(':').map(Number);
	return hour * 60 + minute;
}

/** Returns when a send may go out, or null to send immediately. */
export function quietHoursDeferral(
	location: Pick<LocationRow, 'timezone' | 'quiet_start' | 'quiet_end'>,
	now: Date
): Date | null {
	if (!location.quiet_start || !location.quiet_end) return null;
	const start = parseTime(location.quiet_start);
	const end = parseTime(location.quiet_end);
	if (start === end) return null;
	const local = minutesInTimezone(now, location.timezone);
	const inWindow = start < end ? local >= start && local < end : local >= start || local < end;
	if (!inWindow) return null;
	const minutesUntilEnd = (end - local + 1440) % 1440;
	return new Date(now.getTime() + minutesUntilEnd * 60_000);
}

// ---------- outbound ----------

export async function sendSms(
	sql: Sql,
	ctx: AuthContext,
	contactId: string,
	body: string
): Promise<Message> {
	const contact = await getContact(sql, ctx.accountId, contactId);
	if (!contact) throw new AppError('not_found', 'Contact not found');
	if (!contact.phone) throw new AppError('validation', 'Contact has no phone number');
	if (contact.messagingConsent === 'opted_out') {
		throw new AppError('validation', 'Contact has opted out of SMS');
	}
	await assertCanQueueMessage(sql, ctx.accountId);

	const registration = await getRegistration(sql, ctx.accountId);
	if (!registration || registration.status !== 'approved') {
		throw new AppError('validation', 'Messaging registration is not approved yet');
	}

	const number = await getActiveNumberForLocation(sql, ctx.accountId, contact.locationId);
	if (!number) throw new AppError('validation', 'No phone number provisioned for this location');

	const location = await getLocation(sql, ctx.accountId, contact.locationId);
	if (!location) throw new AppError('internal', 'Contact location missing');
	const notBefore = quietHoursDeferral(location, new Date());

	return sql.begin(async (tx) => {
		const conversation = await findOrCreateConversation(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			locationId: contact.locationId,
			contactId: contact.id,
			phoneNumberId: number.id,
			assigneeUserId: ctx.userId
		});
		const createdAt = new Date();
		const message = await insertMessage(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			locationId: contact.locationId,
			conversationId: conversation.id,
			contactId: contact.id,
			phoneNumberId: number.id,
			direction: 'outbound',
			body,
			status: 'queued',
			providerMessageId: null,
			notBefore,
			createdBy: ctx.userId
		});
		if (!message) throw new AppError('internal', 'Message insert failed');
		await touchConversation(tx, ctx.accountId, conversation.id, createdAt);
		await insertActivity(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			contactId: contact.id,
			companyId: null,
			opportunityId: null,
			type: 'sms.outbound',
			summary: `SMS to ${contactName(contact)}: ${preview(body)}`,
			payload: { messageId: message.id, conversationId: conversation.id },
			createdBy: ctx.userId
		});
		await enqueue(tx, {
			kind: 'message.send',
			accountId: ctx.accountId,
			payload: { messageId: message.id, accountId: ctx.accountId },
			runAfter: notBefore ?? undefined
		});
		return message;
	});
}

/**
 * Queue a system-authored SMS while preserving the same consent, registration,
 * number, conversation, and quiet-hour rules as a human-authored send.
 */
export async function queueAutomatedSms(
	sql: Queryable,
	input: {
		accountId: string;
		locationId: string;
		contactId: string;
		body: string;
		reason: 'missed_call' | 'lead_capture';
	}
): Promise<Message | null> {
	try {
		await assertCanQueueMessage(sql, input.accountId);
	} catch (error) {
		if (error instanceof AppError) return null;
		throw error;
	}
	const contact = await getContact(sql, input.accountId, input.contactId);
	if (!contact?.phone || contact.messagingConsent === 'opted_out') return null;
	const registration = await getRegistration(sql, input.accountId);
	if (!registration || registration.status !== 'approved') return null;
	const number = await getActiveNumberForLocation(sql, input.accountId, input.locationId);
	if (!number) return null;
	const location = await getLocation(sql, input.accountId, input.locationId);
	if (!location) return null;

	const createdAt = new Date();
	const notBefore = quietHoursDeferral(location, createdAt);
	const conversation = await findOrCreateConversation(sql, {
		id: uuidv7(),
		accountId: input.accountId,
		locationId: input.locationId,
		contactId: input.contactId,
		phoneNumberId: number.id,
		assigneeUserId: null
	});
	const message = await insertMessage(sql, {
		id: uuidv7(),
		accountId: input.accountId,
		locationId: input.locationId,
		conversationId: conversation.id,
		contactId: input.contactId,
		phoneNumberId: number.id,
		direction: 'outbound',
		body: input.body,
		status: 'queued',
		providerMessageId: null,
		notBefore,
		createdBy: null
	});
	if (!message) return null;
	await touchConversation(sql, input.accountId, conversation.id, createdAt);
	await insertActivity(sql, {
		id: uuidv7(),
		accountId: input.accountId,
		contactId: input.contactId,
		companyId: null,
		opportunityId: null,
		type: 'sms.outbound',
		summary: `${input.reason === 'lead_capture' ? 'Instant lead reply' : 'Automatic missed-call textback'} to ${contactName(contact)}: ${preview(input.body)}`,
		payload: { messageId: message.id, conversationId: conversation.id, automatedReason: input.reason },
		createdBy: null
	});
	await enqueue(sql, {
		kind: 'message.send',
		accountId: input.accountId,
		payload: { messageId: message.id, accountId: input.accountId },
		runAfter: notBefore ?? undefined
	});
	return message;
}

export async function processMessageSend(
	sql: Sql,
	provider: MessagingProvider,
	payload: Record<string, unknown>
): Promise<void> {
	const messageId = String(payload.messageId ?? '');
	const accountId = String(payload.accountId ?? '');
	const loaded = await getMessageForSend(sql, accountId, messageId);
	if (!loaded || loaded.message.status !== 'queued') return;

	const notBefore = loaded.message.notBefore ? new Date(loaded.message.notBefore) : null;
	if (notBefore && notBefore.getTime() > Date.now()) throw new RetryAt(notBefore);

	// Consent may have changed between queueing and sending (e.g. STOP during quiet hours).
	if (loaded.consent === 'opted_out') {
		await markMessageFailed(sql, accountId, messageId, 'contact opted out');
		return;
	}
	if (!loaded.toPhone) {
		await markMessageFailed(sql, accountId, messageId, 'contact has no phone number');
		return;
	}
	try {
		await assertCanDispatchMessage(sql, accountId);
	} catch (error) {
		if (error instanceof AppError) {
			await markMessageFailed(sql, accountId, messageId, error.message);
			return;
		}
		throw error;
	}

	const result = await provider.sendMessage({
		from: loaded.fromE164,
		to: normalizeE164(loaded.toPhone),
		body: loaded.message.body
	});
	await sql.begin(async (tx) => {
		const marked = await markMessageSent(tx, accountId, messageId, result.providerMessageId);
		if (!marked) return;
		await recordUsage(tx, {
			accountId,
			locationId: loaded.locationId,
			metric: 'message_outbound',
			quantity: 1,
			sourceType: 'message',
			sourceId: messageId
		});
	});
}

function preview(body: string): string {
	return body.length > 80 ? `${body.slice(0, 77)}…` : body;
}

// ---------- inbound / webhooks ----------

export async function processWebhookEvent(
	sql: Sql,
	provider: MessagingProvider,
	payload: Record<string, unknown>
): Promise<void> {
	void provider;
	const event = payload.event as NormalizedWebhookEvent | undefined;
	if (!event) return;

	if (event.type === 'status') {
		const number = await findNumberByE164(sql, event.from);
		if (!number) {
			log('warn', 'status_sms_unknown_number', { from: event.from });
			return;
		}
		await updateMessageStatusByProviderId(
			sql,
			number.accountId,
			event.providerMessageId,
			event.status,
			event.error
		);
		return;
	}

	const number = await findNumberByE164(sql, event.to);
	if (!number) {
		log('warn', 'inbound_sms_unknown_number', { to: event.to });
		return;
	}

	await sql.begin(async (tx) => {
		let contact = await findContactByPhone(tx, number.accountId, event.from);
		let createdContact = false;
		if (!contact) {
			createdContact = true;
			contact = await insertContact(tx, {
				id: uuidv7(),
				accountId: number.accountId,
				locationId: number.locationId,
				firstName: '',
				lastName: '',
				email: null,
				phone: event.from,
				createdBy: null
			});
			await insertActivity(tx, {
				id: uuidv7(),
				accountId: number.accountId,
				contactId: contact.id,
				companyId: null,
				opportunityId: null,
				type: 'contact.created',
				summary: `Contact created from inbound SMS (${event.from})`,
				payload: { contactId: contact.id },
				createdBy: null
			});
			await queueOutboundWebhookEvent(tx, {
				accountId: number.accountId,
				locationId: number.locationId,
				eventType: 'contact.created',
				data: { contact }
			});
		}

		const conversation = await findOrCreateConversation(tx, {
			id: uuidv7(),
			accountId: number.accountId,
			locationId: number.locationId,
			contactId: contact.id,
			phoneNumberId: number.id,
			assigneeUserId: null
		});
		const receivedAt = new Date();

		const message = await insertMessage(tx, {
			id: uuidv7(),
			accountId: number.accountId,
			locationId: number.locationId,
			conversationId: conversation.id,
			contactId: contact.id,
			phoneNumberId: number.id,
			direction: 'inbound',
			body: event.text,
			status: 'received',
			providerMessageId: event.providerMessageId,
			notBefore: null,
			createdBy: null
		});
		if (!message) return; // duplicate provider_message_id — already processed
		await recordUsage(tx, {
			accountId: number.accountId,
			locationId: number.locationId,
			metric: 'message_inbound',
			quantity: 1,
			sourceType: 'message',
			sourceId: message.id,
			occurredAt: receivedAt
		});
		await touchConversation(tx, number.accountId, conversation.id, receivedAt);

		await insertActivity(tx, {
			id: uuidv7(),
			accountId: number.accountId,
			contactId: contact.id,
			companyId: null,
			opportunityId: null,
			type: 'sms.inbound',
			summary: `SMS from ${contactName(contact)}: ${preview(event.text)}`,
			payload: { messageId: message.id, conversationId: conversation.id },
			createdBy: null
		});
		await queueOutboundWebhookEvent(tx, {
			accountId: number.accountId,
			locationId: number.locationId,
			eventType: 'message.received',
			data: { message, conversationId: conversation.id, contact, createdContact }
		});

		const keyword = event.text.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
		if (STOP_WORDS.has(keyword)) {
			await updateContactConsent(tx, number.accountId, contact.id, 'opted_out');
			await insertActivity(tx, {
				id: uuidv7(),
				accountId: number.accountId,
				contactId: contact.id,
				companyId: null,
				opportunityId: null,
				type: 'sms.opt_out',
				summary: `${contactName(contact)} opted out of SMS`,
				payload: {},
				createdBy: null
			});
		} else if (START_WORDS.has(keyword)) {
			await updateContactConsent(tx, number.accountId, contact.id, 'opted_in');
			await insertActivity(tx, {
				id: uuidv7(),
				accountId: number.accountId,
				contactId: contact.id,
				companyId: null,
				opportunityId: null,
				type: 'sms.opt_in',
				summary: `${contactName(contact)} opted in to SMS`,
				payload: {},
				createdBy: null
			});
		} else if (keyword === 'HELP') {
			const registration = await getRegistration(tx, number.accountId);
			if (registration?.status === 'approved') {
				const reply = await insertMessage(tx, {
					id: uuidv7(),
					accountId: number.accountId,
					locationId: number.locationId,
					conversationId: conversation.id,
					contactId: contact.id,
					phoneNumberId: number.id,
					direction: 'outbound',
					body: HELP_REPLY,
					status: 'queued',
					providerMessageId: null,
					notBefore: null,
					createdBy: null
				});
				if (reply) {
					await touchConversation(tx, number.accountId, conversation.id, new Date());
					await enqueue(tx, {
						kind: 'message.send',
						accountId: number.accountId,
						payload: { messageId: reply.id, accountId: number.accountId }
					});
				}
			}
		}
	});
}

// ---------- registration ----------

export async function getAccountRegistration(
	sql: Sql,
	ctx: AuthContext
): Promise<MessagingRegistration | null> {
	return getRegistration(sql, ctx.accountId);
}

export async function submitMessagingRegistration(
	sql: Sql,
	provider: MessagingProvider,
	ctx: AuthContext,
	input: RegistrationFormInput
): Promise<MessagingRegistration> {
	const existing = await getRegistration(sql, ctx.accountId);
	if (existing) throw new AppError('conflict', 'Registration already submitted');

	const result = await provider.submitRegistration(input);
	return insertRegistration(sql, {
		id: uuidv7(),
		accountId: ctx.accountId,
		legalName: input.legalName,
		ein: input.ein,
		website: input.website,
		address: input.address,
		contactEmail: input.contactEmail,
		useCase: input.useCase,
		sampleMessage: input.sampleMessage,
		status: result.status === 'approved' ? 'approved' : 'submitted',
		providerBrandId: result.brandId,
		providerCampaignId: result.campaignId
	});
}

export async function refreshMessagingRegistration(
	sql: Sql,
	provider: MessagingProvider,
	ctx: AuthContext
): Promise<MessagingRegistration | null> {
	const existing = await getRegistration(sql, ctx.accountId);
	if (!existing) throw new AppError('not_found', 'No registration found');
	if (existing.status === 'approved') return existing;
	if (!existing.providerBrandId || !existing.providerCampaignId) return existing;

	const status = await provider.getRegistrationStatus(
		existing.providerBrandId,
		existing.providerCampaignId
	);
	if (status !== existing.status) {
		await updateRegistrationStatus(sql, ctx.accountId, status, null);
	}
	return getRegistration(sql, ctx.accountId);
}

// ---------- numbers ----------

export async function searchAvailableNumbers(
	provider: MessagingProvider,
	areaCode: string | null
): Promise<{ e164: string }[]> {
	return provider.searchNumbers(areaCode);
}

export async function provisionNumber(
	sql: Sql,
	provider: MessagingProvider,
	ctx: AuthContext,
	e164: string
): Promise<PhoneNumber> {
	await assertCanProvisionNumber(sql, ctx.accountId);
	const location = await getLocation(sql, ctx.accountId, ctx.locationId);
	if (!location) throw new AppError('internal', 'Location missing');
	const existing = await getActiveNumberForLocation(sql, ctx.accountId, ctx.locationId);
	if (existing) throw new AppError('conflict', 'This location already has a number');

	const purchased = await provider.purchaseNumber(e164);
	return insertPhoneNumber(sql, {
		id: uuidv7(),
		accountId: ctx.accountId,
		locationId: ctx.locationId,
		e164,
		providerNumberId: purchased.providerNumberId
	});
}

export async function listAccountNumbers(sql: Sql, ctx: AuthContext): Promise<PhoneNumber[]> {
	return listPhoneNumbers(sql, ctx.accountId);
}

// ---------- conversations ----------

export async function getConversationThread(
	sql: Sql,
	ctx: AuthContext,
	conversationId: string
): Promise<{ conversation: Conversation; contact: Contact; messages: Message[] }> {
	const conversation = await getConversation(sql, ctx.accountId, conversationId);
	if (!conversation) throw new AppError('not_found', 'Conversation not found');
	const contact = await getContact(sql, ctx.accountId, conversation.contactId);
	if (!contact) throw new AppError('not_found', 'Contact not found');
	const messages = await listMessagesForConversation(sql, ctx.accountId, conversationId);
	const summary = await getConversationSummary(sql, ctx.accountId, conversationId);
	if (!summary) throw new AppError('not_found', 'Conversation not found');
	return { conversation: summary, contact, messages };
}

export async function getContactMessageThread(
	sql: Sql,
	ctx: AuthContext,
	contactId: string
): Promise<{ contact: Contact; messages: Message[] }> {
	const contact = await getContact(sql, ctx.accountId, contactId);
	if (!contact) throw new AppError('not_found', 'Contact not found');
	const messages = await listMessagesForContact(sql, ctx.accountId, contactId);
	return { contact, messages };
}

export async function sendConversationSms(
	sql: Sql,
	ctx: AuthContext,
	conversationId: string,
	body: string
): Promise<Message> {
	const conversation = await getConversation(sql, ctx.accountId, conversationId);
	if (!conversation) throw new AppError('not_found', 'Conversation not found');
	return sendSms(sql, ctx, conversation.contactId, body);
}

export async function markThreadRead(
	sql: Sql,
	ctx: AuthContext,
	conversationId: string
): Promise<void> {
	const conversation = await getConversation(sql, ctx.accountId, conversationId);
	if (!conversation) throw new AppError('not_found', 'Conversation not found');
	await markConversationRead(sql, ctx.accountId, conversationId);
}

export async function markContactThreadRead(
	sql: Sql,
	ctx: AuthContext,
	contactId: string
): Promise<void> {
	const contact = await getContact(sql, ctx.accountId, contactId);
	if (!contact) throw new AppError('not_found', 'Contact not found');
	await markContactMessagesRead(sql, ctx.accountId, contactId);
}

export async function listAccountConversations(sql: Sql, ctx: AuthContext): Promise<Conversation[]> {
	return listConversations(sql, ctx.accountId);
}
