import { createHash } from 'node:crypto';
import { contactName } from '$lib/format';
import type { Contact, LeadCapture, LeadForm, LeadFormKind, PublicLeadForm } from '$lib/types';
import type { AuthContext } from '../context';
import type { Queryable, Sql } from '../db';
import { AppError } from '../errors';
import { randomToken, uuidv7 } from '../ids';
import { isUsE164, normalizeE164 } from '../phone';
import { insertActivity } from '../repos/activities';
import {
	findContactByEmail,
	findContactByPhone,
	insertContact,
	updateContactFromCapture
} from '../repos/contacts';
import {
	countRecentLeadCaptures,
	countRecentLeadCapturesByIpHash,
	getLeadCaptureBySubmissionKey,
	getLeadForm,
	getPublicLeadForm,
	insertLeadCapture,
	insertLeadForm,
	listLeadForms,
	updateLeadForm
} from '../repos/lead-capture';
import { getActiveNumberForLocation } from '../repos/phone-numbers';
import { insertOpportunity } from '../repos/opportunities';
import { getDefaultPipeline } from '../repos/pipelines';
import { getRegistration } from '../repos/registrations';
import { asObject, optionalString, requiredString } from '../validation';
import { scheduleOpportunityFollowUp } from './ai';
import { assertCanQueueMessage } from './billing';
import { queueAutomatedSms } from './messaging';
import { queueOutboundWebhookEvent } from './outbound-webhooks';

const FORM_DEFINITIONS: Record<
	LeadFormKind,
	{ title: string; intro: string; replyTemplate: string }
> = {
	service: {
		title: 'Request service',
		intro: 'Tell us what you need and we’ll text you back shortly.',
		replyTemplate:
			'Hi {{first_name}}, thanks for contacting {{location_name}}. We received your service request and will text you shortly. Reply STOP to opt out.'
	},
	quote: {
		title: 'Get a quote',
		intro: 'Share a few details and we’ll follow up by text.',
		replyTemplate:
			'Hi {{first_name}}, thanks for requesting a quote from {{location_name}}. We’ll review the details and text you shortly. Reply STOP to opt out.'
	},
	appointment: {
		title: 'Request an appointment',
		intro: 'Tell us what works for you. We’ll confirm a time by text.',
		replyTemplate:
			'Hi {{first_name}}, {{location_name}} received your appointment request. We’ll text you shortly to confirm availability. Reply STOP to opt out.'
	},
	question: {
		title: 'Text us',
		intro: 'Ask a question and our team will reply by text.',
		replyTemplate:
			'Hi {{first_name}}, thanks for reaching out to {{location_name}}. We received your message and will text you shortly. Reply STOP to opt out.'
	}
};

export const DEFAULT_LEAD_FORM_CONSENT =
	'By checking this box and submitting, you agree to receive conversational text messages from this business. Message and data rates may apply. Message frequency varies. Reply STOP to opt out or HELP for help.';

type PublicFormContext = PublicLeadForm & {
	id: string;
	accountId: string;
	locationId: string;
	replyTemplate: string;
};

export type LeadCaptureSubmission = {
	firstName: string;
	lastName: string;
	email: string | null;
	phone: string;
	requestedService: string | null;
	preferredTime: string | null;
	message: string | null;
	sourcePage: string | null;
	referrer: string | null;
	campaign: Record<string, string>;
	submissionKey: string;
	consent: true;
	honeypot: string | null;
};

export function parseLeadCaptureSubmission(body: unknown): LeadCaptureSubmission {
	const obj = asObject(body);
	const firstName = requiredString(obj.firstName, 'firstName', 100);
	const lastName = optionalString(obj.lastName, 'lastName', 100) ?? '';
	const emailValue = optionalString(obj.email, 'email', 320);
	if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
		throw new AppError('validation', 'email is invalid');
	}
	const phone = normalizeE164(requiredString(obj.phone, 'phone', 40));
	if (!isUsE164(phone)) {
		throw new AppError('validation', 'phone must be a valid US phone number');
	}
	const submissionKey = requiredString(obj.submissionKey, 'submissionKey', 100);
	if (!/^[a-zA-Z0-9_-]{12,100}$/.test(submissionKey)) {
		throw new AppError('validation', 'submissionKey is invalid');
	}
	if (obj.consent !== true) {
		throw new AppError('validation', 'Consent is required before we can text you');
	}

	const campaignObj = obj.campaign && typeof obj.campaign === 'object' && !Array.isArray(obj.campaign)
		? (obj.campaign as Record<string, unknown>)
		: {};
	const campaign: Record<string, string> = {};
	for (const key of ['source', 'medium', 'campaign', 'term', 'content']) {
		const value = optionalString(campaignObj[key], `campaign.${key}`, 200);
		if (value) campaign[key] = value;
	}

	return {
		firstName,
		lastName,
		email: emailValue?.toLowerCase() ?? null,
		phone,
		requestedService: optionalString(obj.requestedService, 'requestedService', 200),
		preferredTime: optionalString(obj.preferredTime, 'preferredTime', 200),
		message: optionalString(obj.message, 'message', 2000),
		sourcePage: optionalString(obj.sourcePage, 'sourcePage', 1000),
		referrer: optionalString(obj.referrer, 'referrer', 1000),
		campaign,
		submissionKey,
		consent: true,
		honeypot: optionalString(obj.website, 'website', 200)
	};
}

export function parseLeadFormUpdate(body: unknown): { enabled: boolean; replyTemplate: string } {
	const obj = asObject(body);
	if (typeof obj.enabled !== 'boolean') throw new AppError('validation', 'enabled is invalid');
	return {
		enabled: obj.enabled,
		replyTemplate: requiredString(obj.replyTemplate, 'replyTemplate', 600)
	};
}

function validateForForm(form: PublicFormContext, input: LeadCaptureSubmission): void {
	if ((form.kind === 'service' || form.kind === 'quote') && !input.requestedService) {
		throw new AppError('validation', 'requestedService is required');
	}
	if (form.kind === 'appointment' && !input.preferredTime) {
		throw new AppError('validation', 'preferredTime is required');
	}
	if (form.kind === 'question' && !input.message) {
		throw new AppError('validation', 'message is required');
	}
}

export async function ensureDefaultLeadForms(
	sql: Queryable,
	accountId: string,
	locationId: string
): Promise<LeadForm[]> {
	for (const kind of Object.keys(FORM_DEFINITIONS) as LeadFormKind[]) {
		const definition = FORM_DEFINITIONS[kind];
		await insertLeadForm(sql, {
			id: uuidv7(),
			accountId,
			locationId,
			kind,
			publicKey: `form_${randomToken()}`,
			title: definition.title,
			intro: definition.intro,
			replyTemplate: definition.replyTemplate,
			consentText: DEFAULT_LEAD_FORM_CONSENT
		});
	}
	return listLeadForms(sql, accountId, locationId);
}

export async function getLeadCaptureSettings(
	sql: Sql,
	ctx: AuthContext
): Promise<{
	forms: LeadForm[];
	capturesLast30Days: number;
	ready: boolean;
	readinessMessage: string;
}> {
	const forms = await sql.begin((tx) => ensureDefaultLeadForms(tx, ctx.accountId, ctx.locationId));
	const [capturesLast30Days, registration, number] = await Promise.all([
		countRecentLeadCaptures(sql, ctx.accountId, ctx.locationId),
		getRegistration(sql, ctx.accountId),
		getActiveNumberForLocation(sql, ctx.accountId, ctx.locationId)
	]);
	if (registration?.status !== 'approved') {
		return {
			forms,
			capturesLast30Days,
			ready: false,
			readinessMessage: 'Complete messaging registration before publishing these forms.'
		};
	}
	if (!number) {
		return {
			forms,
			capturesLast30Days,
			ready: false,
			readinessMessage: 'Provision a location phone number before publishing these forms.'
		};
	}
	try {
		await assertCanQueueMessage(sql, ctx.accountId);
	} catch (error) {
		return {
			forms,
			capturesLast30Days,
			ready: false,
			readinessMessage:
				error instanceof AppError ? error.message : 'Messaging billing is not ready.'
		};
	}
	return {
		forms,
		capturesLast30Days,
		ready: true,
		readinessMessage: 'Forms are ready to capture leads and send an immediate text.'
	};
}

export async function editLeadForm(
	sql: Sql,
	ctx: AuthContext,
	id: string,
	input: { enabled: boolean; replyTemplate: string }
): Promise<LeadForm> {
	if (ctx.role !== 'owner') throw new AppError('forbidden', 'Owner access required');
	const current = await getLeadForm(sql, ctx.accountId, id);
	if (!current || current.locationId !== ctx.locationId) {
		throw new AppError('not_found', 'Lead form not found');
	}
	const replyTemplate = requiredString(input.replyTemplate, 'replyTemplate', 600);
	if (!/STOP/i.test(replyTemplate)) {
		throw new AppError('validation', 'The reply must tell the customer how to opt out with STOP');
	}
	const updated = await updateLeadForm(sql, ctx.accountId, id, {
		enabled: input.enabled,
		replyTemplate
	});
	if (!updated) throw new AppError('not_found', 'Lead form not found');
	return updated;
}

export function getPublicLeadCaptureForm(
	sql: Queryable,
	publicKey: string
): Promise<PublicFormContext | null> {
	return getPublicLeadForm(sql, publicKey);
}

function renderReply(template: string, contact: Contact, form: PublicFormContext): string {
	return template
		.replaceAll('{{first_name}}', contact.firstName || 'there')
		.replaceAll('{{last_name}}', contact.lastName)
		.replaceAll('{{location_name}}', form.locationName)
		.replaceAll('{{business_name}}', form.accountName)
		.slice(0, 1600);
}

function leadName(form: PublicFormContext, input: LeadCaptureSubmission, contact: Contact): string {
	const subject =
		input.requestedService ??
		(form.kind === 'appointment'
			? 'Appointment request'
			: form.kind === 'question'
				? 'Website question'
				: FORM_DEFINITIONS[form.kind].title);
	return `${subject} — ${contactName(contact)}`.slice(0, 200);
}

function hashIp(accountId: string, ip: string | null): string | null {
	if (!ip) return null;
	return createHash('sha256').update(`${accountId}\0${ip}`).digest('hex');
}

export async function submitLeadCapture(
	sql: Sql,
	publicKey: string,
	input: LeadCaptureSubmission,
	metadata: { ip: string | null; userAgent: string | null }
): Promise<{ capture: LeadCapture | null; duplicate: boolean; ignored: boolean }> {
	const form = await getPublicLeadForm(sql, publicKey);
	if (!form) throw new AppError('not_found', 'This form is not available');
	validateForForm(form, input);
	if (input.honeypot) return { capture: null, duplicate: false, ignored: true };

	const existing = await getLeadCaptureBySubmissionKey(
		sql,
		form.accountId,
		form.id,
		input.submissionKey
	);
	if (existing) return { capture: existing, duplicate: true, ignored: false };

	const ipHash = hashIp(form.accountId, metadata.ip);
	if (ipHash) {
		const recent = await countRecentLeadCapturesByIpHash(
			sql,
			form.accountId,
			ipHash,
			new Date(Date.now() - 15 * 60_000)
		);
		if (recent >= 5) throw new AppError('forbidden', 'Please wait before submitting again');
	}

	await assertCanQueueMessage(sql, form.accountId);
	const [registration, number, pipeline] = await Promise.all([
		getRegistration(sql, form.accountId),
		getActiveNumberForLocation(sql, form.accountId, form.locationId),
		getDefaultPipeline(sql, form.accountId)
	]);
	if (registration?.status !== 'approved' || !number) {
		throw new AppError('validation', 'This business is not accepting text requests right now');
	}
	if (!pipeline?.stages[0]) throw new AppError('internal', 'Lead pipeline is not configured');

	return sql.begin(async (tx) => {
		await tx`select pg_advisory_xact_lock(hashtextextended(${`${form.id}:${input.submissionKey}`}, 0))`;
		const duplicate = await getLeadCaptureBySubmissionKey(
			tx,
			form.accountId,
			form.id,
			input.submissionKey
		);
		if (duplicate) return { capture: duplicate, duplicate: true, ignored: false };

		let contact =
			(await findContactByPhone(tx, form.accountId, input.phone)) ??
			(input.email ? await findContactByEmail(tx, form.accountId, input.email) : null);
		const createdContact = !contact;
		if (!contact) {
			contact = await insertContact(tx, {
				id: uuidv7(),
				accountId: form.accountId,
				locationId: form.locationId,
				firstName: input.firstName,
				lastName: input.lastName,
				email: input.email,
				phone: input.phone,
				messagingConsent: 'opted_in',
				createdBy: null
			});
		} else {
			contact =
				(await updateContactFromCapture(tx, form.accountId, contact.id, {
					locationId: form.locationId,
					firstName: input.firstName,
					lastName: input.lastName,
					email: input.email,
					phone: input.phone
				})) ?? contact;
		}

		await insertActivity(tx, {
			id: uuidv7(),
			accountId: form.accountId,
			contactId: contact.id,
			companyId: null,
			opportunityId: null,
			type: createdContact ? 'contact.created' : 'contact.matched',
			summary: createdContact
				? `${contactName(contact)} created from ${form.title}`
				: `${contactName(contact)} matched to a new ${form.title.toLowerCase()} submission`,
			payload: { contactId: contact.id, formId: form.id, consent: 'opted_in' },
			createdBy: null
		});

		const opportunity = await insertOpportunity(tx, {
			id: uuidv7(),
			accountId: form.accountId,
			locationId: form.locationId,
			pipelineId: pipeline.id,
			stageId: pipeline.stages[0].id,
			contactId: contact.id,
			companyId: null,
			name: leadName(form, input, contact),
			amountCents: null,
			createdBy: null
		});
		await insertActivity(tx, {
			id: uuidv7(),
			accountId: form.accountId,
			contactId: contact.id,
			companyId: null,
			opportunityId: opportunity.id,
			type: 'opportunity.created',
			summary: `Lead created from ${form.title}`,
			payload: { opportunityId: opportunity.id, formId: form.id, stageId: opportunity.stageId },
			createdBy: null
		});
		await scheduleOpportunityFollowUp(tx, { accountId: form.accountId, opportunity });

		const message = await queueAutomatedSms(tx, {
			accountId: form.accountId,
			locationId: form.locationId,
			contactId: contact.id,
			body: renderReply(form.replyTemplate, contact, form),
			reason: 'lead_capture'
		});
		if (!message) {
			throw new AppError('validation', 'This business is not accepting text requests right now');
		}

		const consentedAt = new Date();
		const capture = await insertLeadCapture(tx, {
			id: uuidv7(),
			accountId: form.accountId,
			locationId: form.locationId,
			formId: form.id,
			contactId: contact.id,
			conversationId: message.conversationId,
			opportunityId: opportunity.id,
			submissionKey: input.submissionKey,
			sourcePage: input.sourcePage,
			referrer: input.referrer,
			campaign: input.campaign,
			requestedService: input.requestedService,
			preferredTime: input.preferredTime,
			message: input.message,
			consentText: form.consentText,
			consentedAt,
			ipHash,
			userAgent: metadata.userAgent?.slice(0, 500) ?? null
		});
		if (!capture) throw new AppError('conflict', 'This request was already submitted');
		await insertActivity(tx, {
			id: uuidv7(),
			accountId: form.accountId,
			contactId: contact.id,
			companyId: null,
			opportunityId: opportunity.id,
			type: 'lead.captured',
			summary: `${form.title} captured from the website`,
			payload: {
				captureId: capture.id,
				conversationId: capture.conversationId,
				formId: form.id,
				sourcePage: input.sourcePage,
				referrer: input.referrer,
				campaign: input.campaign,
				requestedService: input.requestedService,
				preferredTime: input.preferredTime,
				consentedAt: consentedAt.toISOString()
			},
			createdBy: null
		});
		if (createdContact) {
			await queueOutboundWebhookEvent(tx, {
				accountId: form.accountId,
				locationId: form.locationId,
				eventType: 'contact.created',
				data: { contact }
			});
		}
		return { capture, duplicate: false, ignored: false };
	});
}
