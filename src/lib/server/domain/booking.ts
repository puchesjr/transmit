import { prepareSms } from './sms';
import { createHash } from 'node:crypto';
import { contactName } from '$lib/format';
import type {
	Appointment,
	AiConciergeContent,
	BookingQualification,
	BookingService,
	BookingSettings,
	BookingSlot,
	Message,
	PublicBookingProfile,
	PublicBookingState
} from '$lib/types';
import type { AuthContext } from '../context';
import type { Queryable, Sql } from '../db';
import { AppError } from '../errors';
import { uuidv7 } from '../ids';
import { log, serializeError } from '../logger';
import { enqueue } from '../outbox';
import { isUsE164, isUsTollFree, normalizeE164 } from '../phone';
import type { AiProvider } from '../providers/ai';
import type { SchedulerCustomer, SchedulerProvider, SchedulerSlot } from '../providers/scheduler';
import { schedulerProviderConfigured } from '../providers/scheduler';
import { insertActivity } from '../repos/activities';
import { getAiSettings } from '../repos/ai';
import {
	cancelAppointment,
	countRecentBookingSessionsByIpHash,
	ensureBookingDefaults,
	getAppointmentForSession,
	getBookingService,
	getBookingSession,
	getBookingSessionBySubmissionKey,
	getBookingSessionByTokenHash,
	getBookingSessionForConversation,
	getBookingSettings,
	insertAppointment,
	insertBookingService,
	insertBookingSession,
	listBookingServices,
	setBookingBooked,
	setBookingCancelled,
	setBookingExpired,
	setBookingHandoff,
	setBookingHold,
	touchBookingSession,
	updateBookingQualification,
	updateBookingService,
	updateBookingSettings,
	type BookingSessionRecord
} from '../repos/booking';
import {
	findContactByPhone,
	getContact,
	insertContact
} from '../repos/contacts';
import { findOrCreateConversation, touchConversation } from '../repos/conversations';
import { insertLeadCapture } from '../repos/lead-capture';
import { getLocation } from '../repos/locations';
import { insertMessage, listMessagesForBookingSession } from '../repos/messages';
import { getActiveNumberForLocation } from '../repos/phone-numbers';
import { insertOpportunity } from '../repos/opportunities';
import { getDefaultPipeline } from '../repos/pipelines';
import { getRegistration } from '../repos/registrations';
import { asObject, optionalString, requiredString } from '../validation';
import { scheduleOpportunityFollowUp } from './ai';
import { assertCanQueueMessage } from './billing';
import {
	DEFAULT_LEAD_FORM_CONSENT,
	getPublicLeadCaptureForm,
	type PublicFormContext
} from './lead-capture';
import { queueAutomatedSms } from './messaging';
import { queueOutboundWebhookEvent } from './outbound-webhooks';

const MAX_CHAT_LENGTH = 2000;

type BookingContext = {
	form: PublicFormContext;
	settings: BookingSettings | null;
	services: BookingService[];
	timezone: string;
};

export type BookingStartInput = {
	firstName: string;
	lastName: string;
	email: string | null;
	phone: string;
	serviceId: string;
	submissionKey: string;
	sessionToken: string;
	consent: true;
	honeypot: string | null;
	sourcePage: string | null;
	referrer: string | null;
	campaign: Record<string, string>;
};

export function parseBookingStart(body: unknown): BookingStartInput {
	const obj = asObject(body);
	const email = optionalString(obj.email, 'email', 320);
	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new AppError('validation', 'email is invalid');
	}
	const phone = normalizeE164(requiredString(obj.phone, 'phone', 40));
	if (!isUsE164(phone) || isUsTollFree(phone)) throw new AppError('validation', 'phone must be a valid US local number');
	const submissionKey = requiredString(obj.submissionKey, 'submissionKey', 100);
	if (!/^[a-zA-Z0-9_-]{12,100}$/.test(submissionKey)) {
		throw new AppError('validation', 'submissionKey is invalid');
	}
	const sessionToken = requiredString(obj.sessionToken, 'sessionToken', 200);
	if (!/^[a-zA-Z0-9_-]{24,200}$/.test(sessionToken)) {
		throw new AppError('validation', 'sessionToken is invalid');
	}
	if (obj.consent !== true) {
		throw new AppError('validation', 'Consent is required before we can text a confirmation');
	}
	const campaignObj =
		obj.campaign && typeof obj.campaign === 'object' && !Array.isArray(obj.campaign)
			? (obj.campaign as Record<string, unknown>)
			: {};
	const campaign: Record<string, string> = {};
	for (const key of ['source', 'medium', 'campaign', 'term', 'content']) {
		const value = optionalString(campaignObj[key], `campaign.${key}`, 200);
		if (value) campaign[key] = value;
	}
	return {
		firstName: requiredString(obj.firstName, 'firstName', 100),
		lastName: optionalString(obj.lastName, 'lastName', 100) ?? '',
		email: email?.toLowerCase() ?? null,
		phone,
		serviceId: requiredString(obj.serviceId, 'serviceId', 50),
		submissionKey,
		sessionToken,
		consent: true,
		honeypot: optionalString(obj.website, 'website', 200),
		sourcePage: optionalString(obj.sourcePage, 'sourcePage', 1000),
		referrer: optionalString(obj.referrer, 'referrer', 1000),
		campaign
	};
}

export function parseBookingMessage(body: unknown): { body: string } {
	const obj = asObject(body);
	return { body: requiredString(obj.body, 'body', MAX_CHAT_LENGTH) };
}

export function parseBookingHold(body: unknown): { slotId: string } {
	const obj = asObject(body);
	return { slotId: requiredString(obj.slotId, 'slotId', 500) };
}

export function parseBookingCancellation(body: unknown): { reason: string } {
	const obj = asObject(body);
	return {
		reason: optionalString(obj.reason, 'reason', 500) ?? 'Cancelled by the visitor'
	};
}

export function bookingTokenFromRequest(request: Request): string {
	const authorization = request.headers.get('authorization') ?? '';
	const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
	if (!/^[a-zA-Z0-9_-]{24,200}$/.test(token)) {
		throw new AppError('unauthorized', 'Booking session token is required');
	}
	return token;
}

export function parseBookingSettings(body: unknown): Omit<BookingSettings, 'locationId'> {
	const obj = asObject(body);
	if (typeof obj.enabled !== 'boolean') throw new AppError('validation', 'enabled is invalid');
	const minimumNoticeMinutes = Number(obj.minimumNoticeMinutes);
	const bookingWindowDays = Number(obj.bookingWindowDays);
	const sessionTimeoutMinutes = Number(obj.sessionTimeoutMinutes);
	if (!Number.isInteger(minimumNoticeMinutes) || minimumNoticeMinutes < 0 || minimumNoticeMinutes > 10080) {
		throw new AppError('validation', 'minimumNoticeMinutes must be between 0 and 10080');
	}
	if (!Number.isInteger(bookingWindowDays) || bookingWindowDays < 1 || bookingWindowDays > 90) {
		throw new AppError('validation', 'bookingWindowDays must be between 1 and 90');
	}
	if (!Number.isInteger(sessionTimeoutMinutes) || sessionTimeoutMinutes < 5 || sessionTimeoutMinutes > 120) {
		throw new AppError('validation', 'sessionTimeoutMinutes must be between 5 and 120');
	}
	const confirmationTemplate = prepareSms(requiredString(
		obj.confirmationTemplate,
		'confirmationTemplate',
		600
	)).body;
	if (!/STOP/i.test(confirmationTemplate)) {
		throw new AppError('validation', 'The confirmation must explain how to opt out with STOP');
	}
	return {
		enabled: obj.enabled,
		providerLocationId: optionalString(obj.providerLocationId, 'providerLocationId', 200),
		minimumNoticeMinutes,
		bookingWindowDays,
		sessionTimeoutMinutes,
		confirmationTemplate
	};
}

export function parseBookingService(body: unknown): {
	name: string;
	durationMinutes: number;
	providerServiceId: string | null;
	enabled: boolean;
} {
	const obj = asObject(body);
	const durationMinutes = Number(obj.durationMinutes);
	if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
		throw new AppError('validation', 'durationMinutes must be between 15 and 480');
	}
	if (obj.enabled != null && typeof obj.enabled !== 'boolean') {
		throw new AppError('validation', 'enabled is invalid');
	}
	return {
		name: requiredString(obj.name, 'name', 120),
		durationMinutes,
		providerServiceId: optionalString(obj.providerServiceId, 'providerServiceId', 200),
		enabled: obj.enabled !== false
	};
}

function hashCapability(accountId: string, token: string): string {
	return createHash('sha256').update(`${accountId}\0${token}`).digest('hex');
}

function hashIp(accountId: string, ip: string | null): string | null {
	return ip ? createHash('sha256').update(`${accountId}\0${ip}`).digest('hex') : null;
}

async function loadBookingContext(sql: Queryable, publicKey: string): Promise<BookingContext | null> {
	const form = await getPublicLeadCaptureForm(sql, publicKey);
	if (!form || form.kind !== 'appointment') return null;
	const [settings, services, location] = await Promise.all([
		getBookingSettings(sql, form.accountId, form.locationId),
		listBookingServices(sql, form.accountId, form.locationId, false),
		getLocation(sql, form.accountId, form.locationId)
	]);
	if (!location) return null;
	return { form, settings, services, timezone: location.timezone };
}

async function bookingUnavailableReason(
	sql: Queryable,
	context: BookingContext
): Promise<string | null> {
	if (!context.settings?.enabled) return 'Online booking is not enabled for this location.';
	if (context.services.length === 0) return 'No bookable services are configured.';
	if (!schedulerProviderConfigured()) return 'The scheduling connection is not ready.';
	const ai = await getAiSettings(sql, context.form.accountId);
	if (!ai.enabled) return 'The booking concierge is paused.';
	const [registration, number] = await Promise.all([
		getRegistration(sql, context.form.accountId),
		getActiveNumberForLocation(sql, context.form.accountId, context.form.locationId)
	]);
	if (registration?.status !== 'approved' || !number) {
		return 'Text confirmation is not ready for this location.';
	}
	try {
		await assertCanQueueMessage(sql, context.form.accountId);
	} catch (error) {
		return error instanceof AppError ? error.message : 'Messaging billing is not ready.';
	}
	return null;
}

export async function getPublicBookingProfile(
	sql: Queryable,
	publicKey: string
): Promise<PublicBookingProfile | null> {
	const context = await loadBookingContext(sql, publicKey);
	if (!context) return null;
	const unavailableReason = await bookingUnavailableReason(sql, context);
	return {
		publicKey: context.form.publicKey,
		accountName: context.form.accountName,
		locationName: context.form.locationName,
		timezone: context.timezone,
		consentText: context.form.consentText,
		available: unavailableReason == null,
		unavailableReason,
		services: context.services
	};
}

function publicSession(session: BookingSessionRecord): PublicBookingState['session'] {
	const {
		accountId: _accountId,
		formId: _formId,
		captureId: _captureId,
		publicTokenHash: _publicTokenHash,
		submissionKey: _submissionKey,
		offeredSlots: _offeredSlots,
		schedulerHoldId: _schedulerHoldId,
		selectedSlotId: _selectedSlotId,
		aiProvider: _aiProvider,
		aiModel: _aiModel,
		ipHash: _ipHash,
		customerInput: _customerInput,
		...safe
	} = session;
	return safe;
}

async function bookingState(
	sql: Queryable,
	session: BookingSessionRecord
): Promise<PublicBookingState> {
	const [messages, appointment] = await Promise.all([
		listMessagesForBookingSession(sql, session.accountId, session.id),
		getAppointmentForSession(sql, session.accountId, session.id)
	]);
	return {
		session: publicSession(session),
		messages,
		appointment,
		availableSlots: session.status === 'offering' ? session.offeredSlots : []
	};
}

async function insertWebMessage(
	sql: Queryable,
	session: BookingSessionRecord,
	input: { direction: 'inbound' | 'outbound'; body: string; createdBy: string | null }
): Promise<Message> {
	const conversation = await import('../repos/conversations').then(({ getConversation }) =>
		getConversation(sql, session.accountId, session.conversationId)
	);
	if (!conversation) throw new AppError('internal', 'Booking conversation is missing');
	const message = await insertMessage(sql, {
		id: uuidv7(),
		accountId: session.accountId,
		locationId: session.locationId,
		conversationId: session.conversationId,
		contactId: session.contactId,
		phoneNumberId: conversation.phoneNumberId,
		channel: 'web',
		bookingSessionId: session.id,
		direction: input.direction,
		body: input.body,
		status: input.direction === 'inbound' ? 'received' : 'sent',
		providerMessageId: null,
		notBefore: null,
		createdBy: input.createdBy
	});
	if (!message) throw new AppError('internal', 'Booking message could not be saved');
	await touchConversation(sql, session.accountId, session.conversationId, new Date(message.createdAt));
	return message;
}

function appointmentLeadName(service: BookingService, name: string): string {
	return `${service.name} appointment — ${name}`.slice(0, 200);
}

export async function startBookingSession(
	sql: Sql,
	publicKey: string,
	input: BookingStartInput,
	metadata: { ip: string | null; userAgent: string | null }
): Promise<{ state: PublicBookingState | null; duplicate: boolean; ignored: boolean }> {
	const context = await loadBookingContext(sql, publicKey);
	if (!context) throw new AppError('not_found', 'This booking concierge is not available');
	if (input.honeypot) return { state: null, duplicate: false, ignored: true };
	const unavailableReason = await bookingUnavailableReason(sql, context);
	if (unavailableReason) throw new AppError('validation', unavailableReason);
	const service = context.services.find((item) => item.id === input.serviceId);
	if (!service) throw new AppError('validation', 'Select an available service');
	const tokenHash = hashCapability(context.form.accountId, input.sessionToken);
	const existing = await getBookingSessionBySubmissionKey(
		sql,
		context.form.accountId,
		context.form.id,
		input.submissionKey
	);
	if (existing) {
		if (existing.publicTokenHash !== tokenHash) {
			throw new AppError('conflict', 'This booking request is already in use');
		}
		return { state: await bookingState(sql, existing), duplicate: true, ignored: false };
	}

	const ipHash = hashIp(context.form.accountId, metadata.ip);
	if (ipHash) {
		const recent = await countRecentBookingSessionsByIpHash(
			sql,
			context.form.accountId,
			ipHash,
			new Date(Date.now() - 15 * 60_000)
		);
		if (recent >= 5) throw new AppError('forbidden', 'Please wait before starting another chat');
	}

	const [number, pipeline] = await Promise.all([
		getActiveNumberForLocation(sql, context.form.accountId, context.form.locationId),
		getDefaultPipeline(sql, context.form.accountId)
	]);
	if (!number || !pipeline?.stages[0] || !context.settings) {
		throw new AppError('validation', 'This booking concierge is not ready');
	}
	const bookingSettings = context.settings;

	const result = await sql.begin(async (tx) => {
		await tx`select pg_advisory_xact_lock(hashtextextended(${`${context.form.id}:${input.submissionKey}`}, 0))`;
		const duplicate = await getBookingSessionBySubmissionKey(
			tx,
			context.form.accountId,
			context.form.id,
			input.submissionKey
		);
		if (duplicate) {
			if (duplicate.publicTokenHash !== tokenHash) {
				throw new AppError('conflict', 'This booking request is already in use');
			}
			return { session: duplicate, duplicate: true };
		}

		if (ipHash) {
			await tx`select pg_advisory_xact_lock(hashtextextended(${`${context.form.accountId}:booking-ip:${ipHash}`}, 0))`;
			if (await countRecentBookingSessionsByIpHash(tx, context.form.accountId, ipHash,
				new Date(Date.now() - 15 * 60_000)) >= 5) {
				throw new AppError('forbidden', 'Please wait before starting another chat');
			}
		}

		// An email address is not proof of ownership of the CRM customer's phone.
		await tx`select pg_advisory_xact_lock(hashtextextended(${`${context.form.accountId}:booking-phone:${input.phone}`}, 0))`;
		let contact = await findContactByPhone(tx, context.form.accountId, input.phone);
		const createdContact = !contact;
		if (!contact) {
			contact = await insertContact(tx, {
				id: uuidv7(),
				accountId: context.form.accountId,
				locationId: context.form.locationId,
				firstName: input.firstName,
				lastName: input.lastName,
				email: input.email,
				phone: input.phone,
				messagingConsent: 'opted_in',
				createdBy: null
			});
		}

		await insertActivity(tx, {
			id: uuidv7(),
			accountId: context.form.accountId,
			contactId: contact.id,
			companyId: null,
			opportunityId: null,
			type: createdContact ? 'contact.created' : 'contact.matched',
			summary: createdContact
				? `${contactName(contact)} created from online booking`
				: `${contactName(contact)} matched to a new online booking request`,
			payload: { contactId: contact.id, formId: context.form.id, consent: 'opted_in' },
			createdBy: null
		});

		const conversation = await findOrCreateConversation(tx, {
			id: uuidv7(),
			accountId: context.form.accountId,
			locationId: context.form.locationId,
			contactId: contact.id,
			phoneNumberId: number.id,
			assigneeUserId: null
		});
		const opportunity = await insertOpportunity(tx, {
			id: uuidv7(),
			accountId: context.form.accountId,
			locationId: context.form.locationId,
			pipelineId: pipeline.id,
			stageId: pipeline.stages[0].id,
			contactId: contact.id,
			companyId: null,
			name: appointmentLeadName(service, contactName(contact)),
			amountCents: null,
			createdBy: null
		});
		const capture = await insertLeadCapture(tx, {
			id: uuidv7(),
			accountId: context.form.accountId,
			locationId: context.form.locationId,
			formId: context.form.id,
			contactId: contact.id,
			conversationId: conversation.id,
			opportunityId: opportunity.id,
			submissionKey: input.submissionKey,
			sourcePage: input.sourcePage,
			referrer: input.referrer,
			campaign: input.campaign,
			requestedService: service.name,
			preferredTime: null,
			message: 'Online booking concierge started',
			consentText: context.form.consentText || DEFAULT_LEAD_FORM_CONSENT,
			consentedAt: new Date(),
			ipHash,
			userAgent: metadata.userAgent?.slice(0, 500) ?? null
		});
		if (!capture) throw new AppError('conflict', 'This booking request was already submitted');

		const sessionId = uuidv7();
		const expiresAt = new Date(Date.now() + bookingSettings.sessionTimeoutMinutes * 60_000);
		await insertBookingSession(tx, {
			id: sessionId,
			accountId: context.form.accountId,
			locationId: context.form.locationId,
			formId: context.form.id,
			captureId: capture.id,
			contactId: contact.id,
			conversationId: conversation.id,
			opportunityId: opportunity.id,
			serviceId: service.id,
			publicTokenHash: tokenHash,
			submissionKey: input.submissionKey,
			ipHash,
			customerInput: { name: `${input.firstName} ${input.lastName}`.trim(), phone: input.phone, email: input.email },
			expiresAt
		});
		const session = await getBookingSession(tx, context.form.accountId, sessionId);
		if (!session) throw new AppError('internal', 'Booking session could not be created');
		await insertWebMessage(tx, session, {
			direction: 'outbound',
			body: `Hi ${input.firstName || 'there'} — I can help book a ${service.name.toLowerCase()} using ${context.form.locationName}’s live schedule. What is happening, and what is the service address?`,
			createdBy: null
		});
		await insertActivity(tx, {
			id: uuidv7(),
			accountId: context.form.accountId,
			contactId: contact.id,
			companyId: null,
			opportunityId: opportunity.id,
			type: 'booking.started',
			summary: `Online booking started for ${service.name}`,
			payload: {
				sessionId,
				captureId: capture.id,
				conversationId: conversation.id,
				serviceId: service.id,
				consentedAt: capture.consentedAt
			},
			createdBy: null
		});
		await scheduleOpportunityFollowUp(tx, { accountId: context.form.accountId, opportunity });
		await enqueue(tx, {
			kind: 'booking.session.timeout',
			accountId: context.form.accountId,
			payload: { accountId: context.form.accountId, sessionId },
			runAfter: expiresAt
		});
		if (createdContact) {
			await queueOutboundWebhookEvent(tx, {
				accountId: context.form.accountId,
				locationId: context.form.locationId,
				eventType: 'contact.created',
				data: { contact }
			});
		}
		return { session, duplicate: false };
	});
	return {
		state: await bookingState(sql, result.session),
		duplicate: result.duplicate,
		ignored: false
	};
}

async function resolvePublicSession(
	sql: Queryable,
	publicKey: string,
	sessionToken: string
): Promise<{ context: BookingContext; session: BookingSessionRecord }> {
	const context = await loadBookingContext(sql, publicKey);
	if (!context) throw new AppError('not_found', 'This booking concierge is not available');
	const session = await getBookingSessionByTokenHash(
		sql,
		context.form.accountId,
		hashCapability(context.form.accountId, sessionToken)
	);
	if (!session || session.formId !== context.form.id) {
		throw new AppError('not_found', 'Booking conversation not found');
	}
	return { context, session };
}

async function expireIfNeeded(sql: Queryable, session: BookingSessionRecord): Promise<BookingSessionRecord> {
	if (
		!['qualifying', 'offering', 'held'].includes(session.status) ||
		new Date(session.expiresAt).getTime() > Date.now()
	) {
		return session;
	}
	await expireBookingSession(sql, { accountId: session.accountId, sessionId: session.id });
	return (await getBookingSession(sql, session.accountId, session.id)) ?? session;
}

export async function getPublicBookingState(
	sql: Queryable,
	publicKey: string,
	sessionToken: string
): Promise<PublicBookingState> {
	const resolved = await resolvePublicSession(sql, publicKey, sessionToken);
	return bookingState(sql, await expireIfNeeded(sql, resolved.session));
}

function aiMessages(messages: Message[]) {
	return messages.slice(-40).map((message) => ({
		direction: message.direction === 'inbound' ? ('customer' as const) : ('business' as const),
		body: message.body,
		sentAt: message.createdAt
	}));
}

function validateSlots(
	slots: SchedulerSlot[],
	windowStart: Date,
	windowEnd: Date,
	timezone: string,
	durationMinutes: number
): BookingSlot[] {
	const ids = new Set<string>();
	return slots
		.filter((item) => {
			const startsAt = Date.parse(item.startsAt);
			const endsAt = Date.parse(item.endsAt);
			try { new Intl.DateTimeFormat('en-US', { timeZone: item.timezone }).format(); }
			catch { return false; }
			if (!item.id || item.id.length > 500 || ids.has(item.id)) return false;
			ids.add(item.id);
			return (
				item.timezone === timezone &&
				endsAt - startsAt === durationMinutes * 60_000 &&
				Number.isFinite(startsAt) &&
				Number.isFinite(endsAt) &&
				startsAt >= windowStart.getTime() &&
				endsAt > startsAt &&
				endsAt <= windowEnd.getTime()
			);
		})
		.slice(0, 8);
}

async function handoffWithMessage(
	sql: Queryable,
	session: BookingSessionRecord,
	reason: string,
	message: string,
	createdBy: string | null = null
): Promise<void> {
	const changed = await setBookingHandoff(sql, session.accountId, session.id, reason, createdBy);
	if (!changed) return;
	await insertWebMessage(sql, session, { direction: 'outbound', body: message, createdBy });
	await insertActivity(sql, {
		id: uuidv7(),
		accountId: session.accountId,
		contactId: session.contactId,
		companyId: null,
		opportunityId: session.opportunityId,
		type: 'booking.handoff',
		summary: `Booking conversation handed to a person: ${reason}`,
		payload: { sessionId: session.id, conversationId: session.conversationId, reason },
		createdBy
	});
}

async function recordConciergeActivity(
	sql: Queryable,
	session: BookingSessionRecord,
	ai: AiProvider,
	action: AiConciergeContent['action'] | 'failed'
): Promise<void> {
	const summaries: Record<typeof action, string> = {
		ask: 'AI booking concierge continued qualification',
		offer_availability: 'AI booking concierge requested verified scheduler availability',
		handoff: 'AI booking concierge requested human handoff',
		failed: 'AI booking concierge failed and required human handoff'
	};
	await insertActivity(sql, {
		id: uuidv7(),
		accountId: session.accountId,
		contactId: session.contactId,
		companyId: null,
		opportunityId: session.opportunityId,
		type: action === 'failed' ? 'ai.concierge_failed' : 'ai.concierge_turn',
		summary: summaries[action],
		payload: {
			sessionId: session.id,
			provider: ai.name,
			model: ai.model,
			action
		},
		createdBy: null
	});
}

async function schedulerHandoffState(
	sql: Queryable,
	session: BookingSessionRecord,
	reason: string,
	message: string
): Promise<PublicBookingState> {
	await handoffWithMessage(sql, session, reason, message);
	return bookingState(
		sql,
		(await getBookingSession(sql, session.accountId, session.id)) ?? session
	);
}

export async function continueBookingConversation(
	sql: Sql,
	ai: AiProvider,
	scheduler: SchedulerProvider,
	publicKey: string,
	sessionToken: string,
	body: string
): Promise<PublicBookingState> {
	const resolved = await resolvePublicSession(sql, publicKey, sessionToken);
	let session = await expireIfNeeded(sql, resolved.session);
	if (session.status === 'expired') throw new AppError('conflict', 'This booking chat timed out');
	if (['booked', 'cancelled', 'held'].includes(session.status)) {
		throw new AppError('conflict', 'This booking conversation is complete');
	}
	await sql.begin(async (tx) => {
		await tx`select pg_advisory_xact_lock(hashtextextended(${`booking-chat:${session.id}`}, 0))`;
		const messages = await listMessagesForBookingSession(tx, session.accountId, session.id);
		if (messages.filter((message) => message.direction === 'inbound').length >= 40) {
			throw new AppError('forbidden', 'This chat has reached its message limit. Please request a person.');
		}
		await insertWebMessage(tx, session, { direction: 'inbound', body: requiredString(body, 'body', MAX_CHAT_LENGTH), createdBy: null });
	});
	const timeoutMinutes = resolved.context.settings?.sessionTimeoutMinutes ?? 30;
	const expiresAt = new Date(Date.now() + timeoutMinutes * 60_000);
	await touchBookingSession(sql, session.accountId, session.id, expiresAt);
	await enqueue(sql, {
		kind: 'booking.session.timeout',
		accountId: session.accountId,
		payload: { accountId: session.accountId, sessionId: session.id },
		runAfter: expiresAt
	});
	if (session.status === 'handoff' || session.takenOverBy) {
		return bookingState(sql, (await getBookingSession(sql, session.accountId, session.id)) ?? session);
	}

	const [contact, location, service, aiSettings, messages] = await Promise.all([
		getContact(sql, session.accountId, session.contactId),
		getLocation(sql, session.accountId, session.locationId),
		getBookingService(sql, session.accountId, session.locationId, session.serviceId),
		getAiSettings(sql, session.accountId),
		listMessagesForBookingSession(sql, session.accountId, session.id)
	]);
	if (!contact || !location || !service || !resolved.context.settings) {
		throw new AppError('internal', 'Booking context is incomplete');
	}
	if (!aiSettings.enabled || !resolved.context.settings.enabled || !service.enabled || !session.customerInput) {
		await handoffWithMessage(
			sql,
			session,
			'The booking concierge was paused',
			'The online concierge is paused, so I’m bringing in a person from the team.'
		);
		return bookingState(sql, (await getBookingSession(sql, session.accountId, session.id)) ?? session);
	}

	let aiReturned = false;
	try {
		const result = await ai.continueConcierge({
			customerFirstName: session.customerInput?.name.split(' ')[0] ?? 'there',
			locationName: location.name,
			serviceName: service.name,
			qualification: session.qualification,
			messages: aiMessages(messages)
		});
		aiReturned = true;
		await recordConciergeActivity(sql, session, ai, result.action);
		const qualification: BookingQualification = {
			serviceAddress: result.serviceAddress ?? session.qualification.serviceAddress,
			issueSummary: result.issueSummary ?? session.qualification.issueSummary,
			urgency: result.urgency
		};
		if (result.action === 'handoff') {
			await updateBookingQualification(sql, session.accountId, session.id, {
				qualification,
				offeredSlots: [],
				status: 'qualifying',
				aiProvider: ai.name,
				aiModel: ai.model,
				expiresAt
			});
			await handoffWithMessage(
				sql,
				session,
				result.handoffReason ?? 'The concierge was uncertain',
				result.reply
			);
		} else {
			let slots: BookingSlot[] = [];
			let status: 'qualifying' | 'offering' = 'qualifying';
			let reply = result.reply;
			if (result.action === 'offer_availability') {
				if (!qualification.serviceAddress || !qualification.issueSummary) {
					throw new Error('Availability requested before qualification');
				}
				const qualificationSaved = await updateBookingQualification(
					sql,
					session.accountId,
					session.id,
					{
						qualification,
						offeredSlots: [],
						status: 'qualifying',
						aiProvider: ai.name,
						aiModel: ai.model,
						expiresAt
					}
				);
				if (!qualificationSaved) {
					return bookingState(
						sql,
						(await getBookingSession(sql, session.accountId, session.id)) ?? session
					);
				}
				const windowStart = new Date(
					Date.now() + resolved.context.settings.minimumNoticeMinutes * 60_000
				);
				const windowEnd = new Date(
					Date.now() + resolved.context.settings.bookingWindowDays * 86_400_000
				);
				slots = validateSlots(
					await scheduler.getAvailability({
						providerLocationId: resolved.context.settings.providerLocationId,
						providerServiceId: service.providerServiceId,
						serviceName: service.name,
						durationMinutes: service.durationMinutes,
						timezone: location.timezone,
						windowStart,
						windowEnd
					}),
					windowStart,
					windowEnd,
					location.timezone,
					service.durationMinutes
				);
				if (slots.length === 0) {
					return schedulerHandoffState(
						sql,
						session,
						'No scheduler availability was returned',
						'I couldn’t find a reliable opening in the current window. A person from the team will help with the next available time.'
					);
				}
				status = 'offering';
				reply = 'These times are available in the live schedule. Choose one to hold it briefly.';
			}
			const changed = await updateBookingQualification(sql, session.accountId, session.id, {
				qualification,
				offeredSlots: slots,
				status,
				aiProvider: ai.name,
				aiModel: ai.model,
				expiresAt
			});
			if (changed) {
				await insertWebMessage(sql, session, { direction: 'outbound', body: reply, createdBy: null });
			}
		}
	} catch (error) {
		log('error', 'booking_concierge_failed', {
			sessionId: session.id,
			accountId: session.accountId,
			err: serializeError(error)
		});
		if (!aiReturned) {
			try {
				await recordConciergeActivity(sql, session, ai, 'failed');
			} catch (auditError) {
				log('error', 'booking_concierge_audit_failed', {
					sessionId: session.id,
					accountId: session.accountId,
					err: serializeError(auditError)
				});
			}
		}
		session = (await getBookingSession(sql, session.accountId, session.id)) ?? session;
		if (!['handoff', 'booked', 'cancelled', 'expired'].includes(session.status)) {
			await handoffWithMessage(
				sql,
				session,
				'The booking concierge could not continue safely',
				'I couldn’t safely complete that step, so I’m bringing in a person from the team.'
			);
		}
	}
	return bookingState(
		sql,
		(await getBookingSession(sql, session.accountId, session.id)) ?? session
	);
}

function schedulerCustomer(
	contact: NonNullable<Awaited<ReturnType<typeof getContact>>>,
	session: BookingSessionRecord
): SchedulerCustomer {
	if (!session.customerInput || !session.qualification.serviceAddress) {
		throw new AppError('validation', 'The customer and service address must be qualified first');
	}
	return {
		...session.customerInput,
		serviceAddress: session.qualification.serviceAddress
	};
}

function sameSchedulerSlot(left: SchedulerSlot, right: SchedulerSlot): boolean {
	return (
		left.id === right.id &&
		Date.parse(left.startsAt) === Date.parse(right.startsAt) &&
		Date.parse(left.endsAt) === Date.parse(right.endsAt) &&
		left.timezone === right.timezone
	);
}

async function cancelSchedulerSafely(
	sql: Queryable,
	scheduler: SchedulerProvider,
	session: BookingSessionRecord,
	input: Parameters<SchedulerProvider['cancel']>[0],
	event: string
): Promise<void> {
	// Persist before the external call, including crash recovery. Provider keys make replay safe.
	await enqueue(sql, {
		kind: 'booking.scheduler.cleanup', accountId: session.accountId,
		payload: { accountId: session.accountId, sessionId: session.id, provider: scheduler.name, input }
	});
	try {
		await scheduler.cancel(input);
	} catch (error) {
		log('error', event, {
			sessionId: session.id,
			accountId: session.accountId,
			provider: scheduler.name,
			err: serializeError(error)
		});
	}
}

async function schedulingPaused(sql: Queryable, context: BookingContext, session: BookingSessionRecord): Promise<boolean> {
	const [ai, service] = await Promise.all([
		getAiSettings(sql, session.accountId),
		getBookingService(sql, session.accountId, session.locationId, session.serviceId)
	]);
	return !context.settings?.enabled || !ai.enabled || !service?.enabled || !session.customerInput;
}

export async function holdBookingSlot(
	sql: Sql,
	scheduler: SchedulerProvider,
	publicKey: string,
	sessionToken: string,
	slotId: string
): Promise<PublicBookingState> {
	const resolved = await resolvePublicSession(sql, publicKey, sessionToken);
	const session = await expireIfNeeded(sql, resolved.session);
	if (session.status === 'held' && session.selectedSlotId === slotId) {
		return bookingState(sql, session);
	}
	if (session.status !== 'offering') throw new AppError('conflict', 'Choose a current available time');
	if (await schedulingPaused(sql, resolved.context, session)) {
		return schedulerHandoffState(sql, session, 'Online scheduling was paused', 'Online scheduling is paused. A person from the team will help confirm your appointment.');
	}
	const slot = session.offeredSlots.find((item) => item.id === slotId);
	if (!slot || Date.parse(slot.startsAt) <= Date.now()) {
		throw new AppError('conflict', 'That time is no longer available');
	}
	const [contact, service] = await Promise.all([
		getContact(sql, session.accountId, session.contactId),
		getBookingService(sql, session.accountId, session.locationId, session.serviceId)
	]);
	if (!contact || !service || !resolved.context.settings) {
		throw new AppError('internal', 'Booking context is incomplete');
	}
	const customer = schedulerCustomer(contact, session);
	let held: Awaited<ReturnType<SchedulerProvider['hold']>>;
	try {
		held = await scheduler.hold({
			providerLocationId: resolved.context.settings.providerLocationId,
			providerServiceId: service.providerServiceId,
			slot,
			customer,
			idempotencyKey: `hold:${session.id}:${slot.id}`
		});
	} catch (error) {
		log('error', 'booking_scheduler_hold_failed', {
			sessionId: session.id,
			accountId: session.accountId,
			provider: scheduler.name,
			err: serializeError(error)
		});
		return schedulerHandoffState(
			sql,
			session,
			'The scheduler could not verify the selected hold',
			'I couldn’t verify that hold with the live schedule. A person from the team will confirm the right time with you.'
		);
	}
	if (!sameSchedulerSlot(held.slot, slot)) {
		await cancelSchedulerSafely(
			sql,
			scheduler,
			session,
			{
				holdId: held.holdId,
				reason: 'Scheduler returned a slot that was not offered to the customer',
				idempotencyKey: `release-invalid:${session.id}:${slot.id}`
			},
			'booking_invalid_hold_cleanup_failed'
		);
		return schedulerHandoffState(
			sql,
			session,
			'The scheduler returned a hold for a different time',
			'I couldn’t safely verify that time against the live schedule. A person from the team will help confirm an appointment.'
		);
	}
	const holdExpiresAt = new Date(held.expiresAt);
	if (!Number.isFinite(holdExpiresAt.getTime()) || holdExpiresAt.getTime() <= Date.now()) {
		await cancelSchedulerSafely(
			sql,
			scheduler,
			session,
			{
				holdId: held.holdId,
				reason: 'Scheduler returned an expired hold',
				idempotencyKey: `release-expired:${session.id}:${slot.id}`
			},
			'booking_expired_hold_cleanup_failed'
		);
		return schedulerHandoffState(
			sql,
			session,
			'The scheduler returned an expired hold',
			'That hold was already expired, so I’m bringing in a person to confirm a current opening.'
		);
	}
	const changed = await setBookingHold(sql, session.accountId, session.id, {
		holdId: held.holdId,
		slot: held.slot,
		expiresAt: holdExpiresAt
	});
	if (!changed) {
		const current = await getBookingSession(sql, session.accountId, session.id);
		if (
			current?.status === 'held' &&
			current.schedulerHoldId === held.holdId &&
			current.selectedSlotId === held.slot.id
		) {
			return bookingState(sql, current);
		}
		await cancelSchedulerSafely(
			sql,
			scheduler,
			session,
			{
				holdId: held.holdId,
				reason: 'Kiso session changed before the hold completed',
				idempotencyKey: `release:${session.id}:${slot.id}`
			},
			'booking_changed_hold_cleanup_failed'
		);
		throw new AppError('conflict', 'The booking conversation changed');
	}
	await insertWebMessage(sql, session, {
		direction: 'outbound',
		body: `I’ve placed a short hold on ${formatAppointmentTime(held.slot.startsAt, held.slot.timezone)}. Confirm it before the hold expires.`,
		createdBy: null
	});
	await insertActivity(sql, {
		id: uuidv7(),
		accountId: session.accountId,
		contactId: session.contactId,
		companyId: null,
		opportunityId: session.opportunityId,
		type: 'booking.slot_held',
		summary: `Real scheduler slot held for ${formatAppointmentTime(held.slot.startsAt, held.slot.timezone)}`,
		payload: { sessionId: session.id, slotId: held.slot.id, expiresAt: held.expiresAt },
		createdBy: null
	});
	return bookingState(sql, (await getBookingSession(sql, session.accountId, session.id)) ?? session);
}

function formatAppointmentTime(value: string, timezone: string): string {
	return new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short'
	}).format(new Date(value));
}

function renderConfirmation(
	template: string,
	locationName: string,
	appointment: Appointment
): string {
	return template
		.replaceAll('{{location_name}}', locationName)
		.replaceAll(
			'{{appointment_time}}',
			formatAppointmentTime(appointment.startsAt, appointment.timezone)
		)
		.slice(0, 1600);
}

export async function confirmBooking(
	sql: Sql,
	scheduler: SchedulerProvider,
	publicKey: string,
	sessionToken: string
): Promise<PublicBookingState> {
	const resolved = await resolvePublicSession(sql, publicKey, sessionToken);
	let session = await expireIfNeeded(sql, resolved.session);
	const existing = await getAppointmentForSession(sql, session.accountId, session.id);
	if (existing) return bookingState(sql, session);
	if (await schedulingPaused(sql, resolved.context, session)) {
		return schedulerHandoffState(sql, session, 'Online scheduling was paused', 'Online scheduling is paused. A person from the team will help confirm your appointment.');
	}
	if (
		session.status !== 'held' ||
		!session.schedulerHoldId ||
		!session.heldSlot ||
		!session.holdExpiresAt ||
		new Date(session.holdExpiresAt).getTime() <= Date.now()
	) {
		throw new AppError('conflict', 'The appointment hold has expired');
	}
	const [contact, location] = await Promise.all([
		getContact(sql, session.accountId, session.contactId),
		getLocation(sql, session.accountId, session.locationId)
	]);
	if (!contact || !location || !resolved.context.settings) {
		throw new AppError('internal', 'Booking context is incomplete');
	}
	const customer = schedulerCustomer(contact, session);
	let booking: Awaited<ReturnType<SchedulerProvider['book']>>;
	try {
		booking = await scheduler.book({
			holdId: session.schedulerHoldId,
			customer,
			notes: session.qualification.issueSummary ?? '',
			idempotencyKey: `book:${session.id}`
		});
	} catch (error) {
		log('error', 'booking_scheduler_confirmation_failed', {
			sessionId: session.id,
			accountId: session.accountId,
			provider: scheduler.name,
			err: serializeError(error)
		});
		return schedulerHandoffState(
			sql,
			session,
			'The scheduler could not verify the final booking',
			'I couldn’t safely confirm the appointment with the live schedule. A person from the team will verify it before making any promise.'
		);
	}
	if (!sameSchedulerSlot(booking.slot, session.heldSlot)) {
		await cancelSchedulerSafely(
			sql,
			scheduler,
			session,
			{
				bookingId: booking.bookingId,
				reason: 'Scheduler booked a slot that did not match the customer hold',
				idempotencyKey: `cancel-invalid:${session.id}`
			},
			'booking_invalid_confirmation_cleanup_failed'
		);
		return schedulerHandoffState(
			sql,
			session,
			'The scheduler returned a booking for a different time',
			'I couldn’t safely confirm the held time. A person from the team will review the live schedule before confirming anything.'
		);
	}
	const appointmentId = uuidv7();
	let compensateBooking = false;
	try {
		await sql.begin(async (tx) => {
			await tx`select pg_advisory_xact_lock(hashtextextended(${`booking:${session.id}`}, 0))`;
			const committed = await getAppointmentForSession(tx, session.accountId, session.id);
			if (committed) return;
			const current = await getBookingSession(tx, session.accountId, session.id);
			if (
				!current ||
				current.status !== 'held' ||
				current.takenOverBy ||
				current.schedulerHoldId !== session.schedulerHoldId ||
				!current.heldSlot ||
				!sameSchedulerSlot(booking.slot, current.heldSlot) ||
				!current.holdExpiresAt ||
				new Date(current.holdExpiresAt).getTime() <= Date.now()
			) {
				compensateBooking = true;
				throw new AppError('conflict', 'The appointment hold changed before confirmation');
			}
			const markedBooked = await setBookingBooked(tx, session.accountId, session.id);
			if (!markedBooked) {
				compensateBooking = true;
				throw new AppError('conflict', 'The appointment hold changed before confirmation');
			}
			const appointment = await insertAppointment(tx, {
				id: appointmentId,
				accountId: session.accountId,
				locationId: session.locationId,
				bookingSessionId: session.id,
				contactId: session.contactId,
				opportunityId: session.opportunityId,
				serviceId: session.serviceId,
				provider: scheduler.name,
				providerBookingId: booking.bookingId,
				idempotencyKey: `book:${session.id}`,
				slot: booking.slot
			});
			if (!appointment) throw new AppError('internal', 'Appointment could not be saved');
			const confirmation = await queueAutomatedSms(tx, {
				accountId: session.accountId,
				locationId: session.locationId,
				contactId: session.contactId,
				body: renderConfirmation(
					resolved.context.settings!.confirmationTemplate,
					location.name,
					appointment
				),
				reason: 'booking_confirmation'
			});
			await insertWebMessage(tx, session, {
				direction: 'outbound',
				body: confirmation
					? `You’re booked for ${formatAppointmentTime(appointment.startsAt, appointment.timezone)}. We’ll also send the confirmation by text.`
					: `You’re booked for ${formatAppointmentTime(appointment.startsAt, appointment.timezone)}. A text confirmation could not be sent, but the appointment is saved.`,
				createdBy: null
			});
			await insertActivity(tx, {
				id: uuidv7(),
				accountId: session.accountId,
				contactId: session.contactId,
				companyId: null,
				opportunityId: session.opportunityId,
				type: 'appointment.booked',
				summary: `${session.serviceName} booked for ${formatAppointmentTime(appointment.startsAt, appointment.timezone)}`,
				payload: {
					sessionId: session.id,
					appointmentId: appointment.id,
					startsAt: appointment.startsAt,
					endsAt: appointment.endsAt,
					timezone: appointment.timezone,
					confirmationMessageId: confirmation?.id ?? null
				},
				createdBy: null
			});
		});
	} catch (error) {
		if (compensateBooking) {
			await cancelSchedulerSafely(sql, scheduler, session, {
				bookingId: booking.bookingId,
				reason: 'Kiso session changed before the provider booking was committed',
				idempotencyKey: `cancel-race:${session.id}`
			}, 'booking_compensation_failed');
		}
		throw error;
	}
	session = (await getBookingSession(sql, session.accountId, session.id)) ?? session;
	return bookingState(sql, session);
}

export async function cancelBooking(
	sql: Sql,
	scheduler: SchedulerProvider,
	publicKey: string,
	sessionToken: string,
	reason: string
): Promise<PublicBookingState> {
	const resolved = await resolvePublicSession(sql, publicKey, sessionToken);
	await enqueue(sql, {
		kind: 'booking.scheduler.cleanup', accountId: resolved.session.accountId,
		payload: { accountId: resolved.session.accountId, sessionId: resolved.session.id,
			provider: scheduler.name, action: 'cancel_session', reason }
	});
	return cancelBookingSession(sql, scheduler, resolved.session, reason);
}

async function cancelBookingSession(
	sql: Sql, scheduler: SchedulerProvider, target: BookingSessionRecord, reason: string
): Promise<PublicBookingState> {
	return sql.begin(async (tx) => {
		await tx`select pg_advisory_xact_lock(hashtextextended(${`booking:${target.id}`}, 0))`;
		const session = await getBookingSession(tx, target.accountId, target.id);
		if (!session) throw new AppError('not_found', 'Booking session not found');
		if (session.status === 'cancelled') return bookingState(tx, session);
		const appointment = await getAppointmentForSession(tx, session.accountId, session.id);
		if (appointment?.status === 'booked') {
			await scheduler.cancel({
				bookingId: await providerBookingId(tx, session.accountId, appointment.id),
				reason,
				idempotencyKey: `cancel-booking:${session.id}`
			});
			await cancelAppointment(tx, session.accountId, appointment.id, reason);
		} else if (session.schedulerHoldId) {
			await scheduler.cancel({
				holdId: session.schedulerHoldId,
				reason,
				idempotencyKey: `cancel-hold:${session.id}`
			});
		}
		await setBookingCancelled(tx, session.accountId, session.id);
		await insertWebMessage(tx, session, {
			direction: 'outbound',
			body: 'The appointment request has been cancelled. If you still need help, the team can start a new request with you.',
			createdBy: null
		});
		await insertActivity(tx, {
			id: uuidv7(),
			accountId: session.accountId,
			contactId: session.contactId,
			companyId: null,
			opportunityId: session.opportunityId,
			type: 'appointment.cancelled',
			summary: `Appointment booking cancelled: ${reason}`,
			payload: { sessionId: session.id, appointmentId: appointment?.id ?? null },
			createdBy: null
		});
		return bookingState(tx, (await getBookingSession(tx, session.accountId, session.id)) ?? session);
	});
}

async function providerBookingId(sql: Queryable, accountId: string, appointmentId: string): Promise<string> {
	const rows = await sql<{ provider_booking_id: string }[]>`
		select provider_booking_id
		from appointments
		where account_id = ${accountId} and id = ${appointmentId}
		limit 1
	`;
	if (!rows[0]) throw new AppError('not_found', 'Appointment not found');
	return rows[0].provider_booking_id;
}

export async function requestBookingHandoff(
	sql: Sql,
	publicKey: string,
	sessionToken: string
): Promise<PublicBookingState> {
	const resolved = await resolvePublicSession(sql, publicKey, sessionToken);
	await handoffWithMessage(
		sql,
		resolved.session,
		'The visitor asked for a person',
		'I’ll bring in a person from the team. You can keep this page open, and they can also follow up by text.'
	);
	return bookingState(
		sql,
		(await getBookingSession(sql, resolved.session.accountId, resolved.session.id)) ??
			resolved.session
	);
}

export async function expireBookingSession(
	sql: Queryable,
	payload: { accountId?: unknown; sessionId?: unknown }
): Promise<void> {
	const accountId = String(payload.accountId ?? '');
	const sessionId = String(payload.sessionId ?? '');
	if (!accountId || !sessionId) return;
	const session = await getBookingSession(sql, accountId, sessionId);
	if (!session) return;
	const changed = await setBookingExpired(sql, accountId, sessionId);
	if (!changed) return;
	await insertWebMessage(sql, session, {
		direction: 'outbound',
		body: 'This chat timed out before booking was complete. The team can see the request and will follow up, or you can start a new booking.',
		createdBy: null
	});
	await insertActivity(sql, {
		id: uuidv7(),
		accountId,
		contactId: session.contactId,
		companyId: null,
		opportunityId: session.opportunityId,
		type: 'booking.expired',
		summary: 'Online booking timed out and needs human follow-up',
		payload: { sessionId, conversationId: session.conversationId },
		createdBy: null
	});
}

export async function getAccountBookingSettings(
	sql: Sql,
	ctx: AuthContext
): Promise<{
	settings: BookingSettings;
	services: BookingService[];
	providerConfigured: boolean;
	appointmentPublicKey: string | null;
}> {
	await sql.begin((tx) => ensureBookingDefaults(tx, ctx.accountId, ctx.locationId));
	const [settings, services] = await Promise.all([
		getBookingSettings(sql, ctx.accountId, ctx.locationId),
		listBookingServices(sql, ctx.accountId, ctx.locationId)
	]);
	const forms = await import('../repos/lead-capture').then(({ listLeadForms }) =>
		listLeadForms(sql, ctx.accountId, ctx.locationId)
	);
	if (!settings) throw new AppError('internal', 'Booking settings are missing');
	return {
		settings,
		services,
		providerConfigured: schedulerProviderConfigured(),
		appointmentPublicKey: forms.find((form) => form.kind === 'appointment')?.publicKey ?? null
	};
}

export async function editBookingSettings(
	sql: Sql,
	ctx: AuthContext,
	input: Omit<BookingSettings, 'locationId'>
): Promise<BookingSettings> {
	if (ctx.role !== 'owner') throw new AppError('forbidden', 'Owner access required');
	await ensureBookingDefaults(sql, ctx.accountId, ctx.locationId);
	const updated = await updateBookingSettings(sql, ctx.accountId, ctx.locationId, {
		...input, confirmationTemplate: prepareSms(input.confirmationTemplate).body
	});
	if (!updated) throw new AppError('not_found', 'Booking settings not found');
	return updated;
}

export async function createBookingService(
	sql: Sql,
	ctx: AuthContext,
	input: ReturnType<typeof parseBookingService>
): Promise<BookingService> {
	if (ctx.role !== 'owner') throw new AppError('forbidden', 'Owner access required');
	return insertBookingService(sql, {
		id: uuidv7(),
		accountId: ctx.accountId,
		locationId: ctx.locationId,
		name: input.name,
		durationMinutes: input.durationMinutes,
		providerServiceId: input.providerServiceId
	});
}

export async function editBookingService(
	sql: Sql,
	ctx: AuthContext,
	id: string,
	input: ReturnType<typeof parseBookingService>
): Promise<BookingService> {
	if (ctx.role !== 'owner') throw new AppError('forbidden', 'Owner access required');
	const updated = await updateBookingService(sql, ctx.accountId, ctx.locationId, id, input);
	if (!updated) throw new AppError('not_found', 'Booking service not found');
	return updated;
}

export async function getConversationBookingContext(
	sql: Queryable,
	ctx: AuthContext,
	conversationId: string
): Promise<{ session: PublicBookingState['session']; appointment: Appointment | null } | null> {
	const session = await getBookingSessionForConversation(sql, ctx.accountId, conversationId);
	if (!session || session.locationId !== ctx.locationId) return null;
	return {
		session: publicSession(session),
		appointment: await getAppointmentForSession(sql, ctx.accountId, session.id)
	};
}

export async function takeOverBookingSession(
	sql: Sql,
	ctx: AuthContext,
	id: string
): Promise<PublicBookingState['session']> {
	const session = await getBookingSession(sql, ctx.accountId, id);
	if (!session || session.locationId !== ctx.locationId) {
		throw new AppError('not_found', 'Booking session not found');
	}
	if (['booked', 'cancelled', 'expired'].includes(session.status)) {
		throw new AppError('conflict', 'This booking conversation is complete');
	}
	const changed = await setBookingHandoff(
		sql,
		ctx.accountId,
		session.id,
		'Taken over by a team member',
		ctx.userId
	);
	if (changed) {
		await insertWebMessage(sql, session, {
			direction: 'outbound',
			body: 'A team member has joined the conversation and will help from here.',
			createdBy: ctx.userId
		});
		await insertActivity(sql, {
			id: uuidv7(),
			accountId: ctx.accountId,
			contactId: session.contactId,
			companyId: null,
			opportunityId: session.opportunityId,
			type: 'booking.taken_over',
			summary: 'A team member took over the website booking conversation',
			payload: { sessionId: session.id, conversationId: session.conversationId },
			createdBy: ctx.userId
		});
	}
	return publicSession((await getBookingSession(sql, ctx.accountId, id)) ?? session);
}

export async function sendHumanBookingReply(
	sql: Sql,
	ctx: AuthContext,
	id: string,
	body: string
): Promise<Message> {
	const session = await getBookingSession(sql, ctx.accountId, id);
	if (!session || session.locationId !== ctx.locationId) {
		throw new AppError('not_found', 'Booking session not found');
	}
	if (session.status !== 'handoff' || !session.takenOverBy) {
		throw new AppError('conflict', 'Take over this booking conversation before replying');
	}
	return insertWebMessage(sql, session, {
		direction: 'outbound',
		body: requiredString(body, 'body', MAX_CHAT_LENGTH),
		createdBy: ctx.userId
	});
}

export async function processSchedulerCleanup(
	sql: Sql, scheduler: SchedulerProvider, payload: Record<string, unknown>
): Promise<void> {
	const accountId = requiredString(payload.accountId, 'accountId', 50);
	const sessionId = requiredString(payload.sessionId, 'sessionId', 50);
	const session = await getBookingSession(sql, accountId, sessionId);
	if (!session) return;
	if (payload.provider !== scheduler.name) throw new Error('Scheduler cleanup provider changed');
	if (payload.action === 'cancel_session') {
		await cancelBookingSession(sql, scheduler, session, requiredString(payload.reason, 'reason', 500));
		return;
	}
	const input = asObject(payload.input);
	const bookingId = optionalString(input.bookingId, 'bookingId', 500) ?? undefined;
	const holdId = optionalString(input.holdId, 'holdId', 500) ?? undefined;
	if (!bookingId && !holdId) throw new Error('Scheduler cleanup target missing');
	await scheduler.cancel({ bookingId, holdId,
		reason: requiredString(input.reason, 'reason', 500),
		idempotencyKey: requiredString(input.idempotencyKey, 'idempotencyKey', 1000)
	});
}
