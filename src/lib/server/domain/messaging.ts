import { TELECOM_PRICE } from '$lib/pricing';
import { requireTelecomPayment, startTelecomResource } from './telecom';
import { claimTelecomOperation, markTelecomReview } from '../repos/telecom';
import { smsMetrics } from '$lib/sms';
import { prepareSms } from './sms';
import { contactName } from '$lib/format';
import type { Contact, Conversation, Message, MessagingRegistration, PhoneNumber } from '$lib/types';
import type { AuthContext } from '../context';
import type { Queryable, Sql } from '../db';
import { AppError } from '../errors';
import { uuidv7 } from '../ids';
import { log } from '../logger';
import { enqueue, RetryAt } from '../outbox';
import { isUsE164, isUsTollFree, normalizeE164 } from '../phone';
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
	claimSmsDispatch, attachSmsProviderId, getOutboundSmsByProviderId,
	updateQueuedSms,
	recordMessageCost,
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
	getPhoneNumber,
	insertPhoneNumber,
	listPhoneNumbers,
	listUnassignedPhoneNumbers,
	markCampaignAssigned
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
	'Thanks for reaching out - reply here and we will get back to you. Reply STOP to opt out.';
const MAX_SMS_LENGTH = 1600;

// ---------- parsing ----------

export function parseSendMessage(body: unknown): { body: string } {
	const obj = asObject(body);
	return { body: prepareSms(requiredString(obj.body, 'body', MAX_SMS_LENGTH)).body };
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
	if (isUsTollFree(e164)) {
		throw new AppError('validation', 'Use a local number, not a toll-free number');
	}
	return { e164 };
}

export type RegistrationFormInput = {
	legalName: string;
	ein: string | null;
	website: string | null;
	address: string;
	city: string;
	region: string;
	postalCode: string;
	contactEmail: string;
	contactPhone: string;
	useCase: string;
	sampleMessage: string;
};

export function parseRegistration(body: unknown): RegistrationFormInput {
	const obj = asObject(body);
	const region = requiredString(obj.region, 'region', 2).toUpperCase();
	if (!/^[A-Z]{2}$/.test(region)) {
		throw new AppError('validation', 'region must be a 2-letter US state');
	}
	const postalCode = requiredString(obj.postalCode, 'postalCode', 10);
	if (!/^\d{5}(-\d{4})?$/.test(postalCode)) {
		throw new AppError('validation', 'postalCode must be a US ZIP code');
	}
	const contactPhone = normalizeE164(requiredString(obj.contactPhone, 'contactPhone', 20));
	if (!isUsE164(contactPhone) || isUsTollFree(contactPhone)) {
		throw new AppError('validation', 'contactPhone must be a US local number');
	}
	return {
		legalName: requiredString(obj.legalName, 'legalName', 200),
		ein: optionalString(obj.ein, 'ein', 20),
		website: optionalString(obj.website, 'website', 200),
		address: requiredString(obj.address, 'address', 300),
		city: requiredString(obj.city, 'city', 80),
		region,
		postalCode: postalCode.slice(0, 5),
		contactEmail: parseEmail(obj.contactEmail),
		contactPhone,
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
	const prepared = prepareSms(body);
	body = prepared.body;
	const contact = await getContact(sql, ctx.accountId, contactId);
	if (!contact) throw new AppError('not_found', 'Contact not found');
	if (!contact.phone) throw new AppError('validation', 'Contact has no phone number');
	if (contact.messagingConsent === 'opted_out') {
		throw new AppError('validation', 'Contact has opted out of SMS');
	}


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
		await tx`select id from billing_accounts where account_id = ${ctx.accountId} for update`;
		await assertCanQueueMessage(tx, ctx.accountId, prepared.segments);
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
			smsSegments: prepared.segments, smsEncoding: 'GSM-7',
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
		reason: 'missed_call' | 'lead_capture' | 'booking_confirmation';
	}
): Promise<Message | null> {
	let prepared;
	try {
		prepared = prepareSms(input.body);
		input = { ...input, body: prepared.body };
		await sql`select id from billing_accounts where account_id = ${input.accountId} for update`;
		await assertCanQueueMessage(sql, input.accountId, prepared.segments);
	} catch (error) {
		if (error instanceof AppError) { log('warn','automated_sms_blocked',{accountId:input.accountId,reason:input.reason,code:error.code}); return null; }
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
		smsSegments: prepared.segments, smsEncoding: 'GSM-7',
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
		summary: `${
			input.reason === 'lead_capture'
				? 'Instant lead reply'
				: input.reason === 'booking_confirmation'
					? 'Appointment confirmation'
					: 'Automatic missed-call textback'
		} to ${contactName(contact)}: ${preview(input.body)}`,
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
	if (!loaded || loaded.message.status !== 'queued' || loaded.message.channel !== 'sms') return;
	let prepared;
	try { prepared = prepareSms(loaded.message.body); } catch (error) {
		if (!(error instanceof AppError)) throw error;
		await markMessageFailed(sql, accountId, messageId, error.message); return;
	}
	await updateQueuedSms(sql, accountId, messageId, prepared.body, prepared.segments);

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
		await assertCanDispatchMessage(sql, accountId, prepared.segments);
	} catch (error) {
		if (error instanceof AppError) {
			await markMessageFailed(sql, accountId, messageId, error.message);
			return;
		}
		throw error;
	}

	if (!await claimSmsDispatch(sql,accountId,messageId)) {
  const [attempt] = await sql<{dispatch_started_at:Date|null}[]>`select dispatch_started_at from messages where account_id = ${accountId} and id = ${messageId}`;
  const retryAt = new Date((attempt?.dispatch_started_at?.getTime() ?? Date.now())+60_000);
  if (retryAt > new Date()) throw new RetryAt(retryAt);
  await markMessageFailed(sql,accountId,messageId,'Delivery is uncertain. Check provider records before resending.');
  return;
 }
 let result;
 try { result = await provider.sendMessage({
		from: loaded.fromE164,
		to: normalizeE164(loaded.toPhone),
		body: prepared.body, clientMessageId: messageId
 }); } catch (error) {
  await markMessageFailed(sql,accountId,messageId,'Delivery is uncertain. Check provider records before resending.');
  throw error;
 }
 await sql.begin(async (tx) => {
		const marked = await markMessageSent(tx, accountId, messageId, result.providerMessageId);
		if (!marked) return;
		await recordUsage(tx, {
			accountId,
			locationId: loaded.locationId,
			metric: 'message_outbound',
			quantity: prepared.segments,
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
if (event.clientMessageId) await attachSmsProviderId(sql,number.accountId,number.id,event.clientMessageId,event.providerMessageId);
  const message = await getOutboundSmsByProviderId(sql,number.accountId,event.providerMessageId);
  if (!message) throw new Error('SMS status is awaiting message correlation');
  await recordUsage(sql,{accountId:number.accountId,locationId:message.location_id,metric:'message_outbound',
   quantity:message.sms_segments ?? smsMetrics(message.body).segments,sourceType:'message',sourceId:message.id});
  if (event.parts != null && message.sms_segments != null && event.parts !== message.sms_segments) {
   log('warn','sms_segment_mismatch',{accountId:number.accountId,messageId:message.id,estimated:message.sms_segments,actual:event.parts});
  }
  await recordMessageCost(sql, number.accountId, event.providerMessageId, event.parts ?? null, event.costUsd ?? null);
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
			smsSegments: event.parts ?? (smsMetrics(event.text).segments || 1),
			smsEncoding: smsMetrics(event.text).encoding,
			status: 'received',
			providerMessageId: event.providerMessageId,
			notBefore: null,
			createdBy: null
		});
		if (!message) return; // duplicate provider_message_id — already processed
		await recordMessageCost(tx, number.accountId, event.providerMessageId, event.parts ?? null, event.costUsd ?? null);
		await recordUsage(tx, {
			accountId: number.accountId,
			locationId: number.locationId,
			metric: 'message_inbound',
			quantity: event.parts ?? (smsMetrics(event.text).segments || 1),
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
	if (!input.ein || !/^\d{2}-?\d{7}$/.test(input.ein)) throw new AppError('validation','An EIN is required for this Low Volume Mixed registration. Contact support for sole-proprietor registration before paying.');
 input = { ...input, sampleMessage: prepareSms(input.sampleMessage).body };

	const chargeId = await requireTelecomPayment(sql, ctx, 'registration:initial',
  '10DLC brand ($4.50), campaign review ($15), first 3 months ($4.50)',
  TELECOM_PRICE.brandCents + TELECOM_PRICE.campaignReviewCents + TELECOM_PRICE.campaignMonthlyCents * TELECOM_PRICE.campaignInitialMonths);
 if (!await claimTelecomOperation(sql,ctx.accountId,chargeId)) throw new AppError('conflict','Registration is processing or needs support reconciliation. Do not resubmit.');
 try {
 const result = await provider.submitRegistration({...input,sampleMessage:prepareSms(input.sampleMessage).body});
 return await sql.begin(async tx => {
 const registration = await insertRegistration(tx, {
		id: uuidv7(),
		accountId: ctx.accountId,
		legalName: input.legalName,
		ein: input.ein,
		website: input.website,
		address: input.address,
		city: input.city,
		region: input.region,
		postalCode: input.postalCode,
		contactEmail: input.contactEmail,
		contactPhone: input.contactPhone,
		useCase: input.useCase,
		sampleMessage: input.sampleMessage,
		status: result.status === 'approved' ? 'approved' : 'submitted',
		providerBrandId: result.brandId,
		providerCampaignId: result.campaignId
 });
 await startTelecomResource(tx,ctx,'campaign',registration.id);
 return registration;
 });
 } catch (error) { await markTelecomReview(sql,ctx.accountId,chargeId); throw error; }
}

export async function refreshMessagingRegistration(
	sql: Sql,
	provider: MessagingProvider,
	ctx: AuthContext
): Promise<MessagingRegistration | null> {
	const existing = await getRegistration(sql, ctx.accountId);
	if (!existing) throw new AppError('not_found', 'No registration found');
	let status = existing.status;
	if (status !== 'approved' && existing.providerBrandId && existing.providerCampaignId) {
		status = await provider.getRegistrationStatus(
			existing.providerBrandId,
			existing.providerCampaignId
		);
		if (status !== existing.status) {
			await updateRegistrationStatus(sql, ctx.accountId, status, null);
		}
	}
	if (status === 'approved') {
		await enqueueUnassignedCampaignAssignments(sql, ctx.accountId);
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

	if (isUsTollFree(e164)) {
		throw new AppError('validation', 'Use a local number, not a toll-free number');
	}

	const chargeId = await requireTelecomPayment(sql,ctx,`number:${ctx.locationId}`,
  `Local SMS and voice number: first month ($1.10), then $1.10/month`,TELECOM_PRICE.numberMonthlyCents);
 if (!await claimTelecomOperation(sql,ctx.accountId,chargeId)) throw new AppError('conflict','Number purchase is processing or needs support reconciliation. Do not repurchase.');
 let number: PhoneNumber;
 try {
 const purchased = await provider.purchaseNumber(e164);
 number = await sql.begin(async tx => {
 const result = await insertPhoneNumber(tx, {
		id: uuidv7(),
		accountId: ctx.accountId,
		locationId: ctx.locationId,
		e164,
		providerNumberId: purchased.providerNumberId
 });
 await startTelecomResource(tx,ctx,'number',result.id);
 return result;
 });
 } catch (error) { await markTelecomReview(sql,ctx.accountId,chargeId); throw error; }
	const registration = await getRegistration(sql, ctx.accountId);
	if (registration?.status === 'approved' && registration.providerCampaignId) {
		await enqueue(sql, {
			kind: 'phone_number.assign_campaign',
			accountId: ctx.accountId,
			payload: { accountId: ctx.accountId, phoneNumberId: number.id }
		});
	}
	return number;
}

async function enqueueUnassignedCampaignAssignments(sql: Queryable, accountId: string): Promise<void> {
	const numbers = await listUnassignedPhoneNumbers(sql, accountId);
	for (const number of numbers) {
		await enqueue(sql, {
			kind: 'phone_number.assign_campaign',
			accountId,
			payload: { accountId, phoneNumberId: number.id }
		});
	}
}

export async function processAssignCampaign(
	sql: Sql,
	provider: MessagingProvider,
	payload: Record<string, unknown>
): Promise<void> {
	const accountId = String(payload.accountId ?? '');
	const phoneNumberId = String(payload.phoneNumberId ?? '');
	const number = await getPhoneNumber(sql, accountId, phoneNumberId);
	if (!number || number.campaignAssignedAt) return;
	const registration = await getRegistration(sql, accountId);
	if (!registration?.providerCampaignId) return;
	if (registration.status === 'rejected') return;
	if (registration.status !== 'approved') {
		throw new RetryAt(new Date(Date.now() + 60_000));
	}
	await provider.assignNumberToCampaign({
		phoneNumber: number.e164,
		campaignId: registration.providerCampaignId
	});
	await markCampaignAssigned(sql, accountId, number.id);
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
