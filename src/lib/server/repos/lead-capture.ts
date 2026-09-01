import type { LeadCapture, LeadForm, LeadFormKind, PublicLeadForm } from '$lib/types';
import type { Queryable } from '../db';

type LeadFormRow = {
	id: string;
	location_id: string;
	kind: LeadFormKind;
	public_key: string;
	title: string;
	intro: string;
	reply_template: string;
	consent_text: string;
	enabled: boolean;
	created_at: Date;
	updated_at: Date;
};

type PublicLeadFormRow = LeadFormRow & {
	account_name: string;
	location_name: string;
};

type LeadCaptureRow = {
	id: string;
	location_id: string;
	form_id: string;
	contact_id: string;
	conversation_id: string;
	opportunity_id: string;
	source_page: string | null;
	referrer: string | null;
	campaign: Record<string, string>;
	requested_service: string | null;
	preferred_time: string | null;
	message: string | null;
	consented_at: Date;
	created_at: Date;
};

const FORM_COLUMNS = [
	'id',
	'location_id',
	'kind',
	'public_key',
	'title',
	'intro',
	'reply_template',
	'consent_text',
	'enabled',
	'created_at',
	'updated_at'
] as const;

function mapLeadForm(row: LeadFormRow): LeadForm {
	return {
		id: row.id,
		locationId: row.location_id,
		kind: row.kind,
		publicKey: row.public_key,
		title: row.title,
		intro: row.intro,
		replyTemplate: row.reply_template,
		consentText: row.consent_text,
		enabled: row.enabled,
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString()
	};
}

function mapCapture(row: LeadCaptureRow): LeadCapture {
	return {
		id: row.id,
		locationId: row.location_id,
		formId: row.form_id,
		contactId: row.contact_id,
		conversationId: row.conversation_id,
		opportunityId: row.opportunity_id,
		sourcePage: row.source_page,
		referrer: row.referrer,
		campaign: row.campaign ?? {},
		requestedService: row.requested_service,
		preferredTime: row.preferred_time,
		message: row.message,
		consentedAt: row.consented_at.toISOString(),
		createdAt: row.created_at.toISOString()
	};
}

export async function insertLeadForm(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		locationId: string;
		kind: LeadFormKind;
		publicKey: string;
		title: string;
		intro: string;
		replyTemplate: string;
		consentText: string;
	}
): Promise<LeadForm | null> {
	const rows = await sql<LeadFormRow[]>`
		insert into lead_forms (
			id, account_id, location_id, kind, public_key, title, intro, reply_template, consent_text
		)
		values (
			${row.id}, ${row.accountId}, ${row.locationId}, ${row.kind}, ${row.publicKey},
			${row.title}, ${row.intro}, ${row.replyTemplate}, ${row.consentText}
		)
		on conflict (account_id, location_id, kind) do nothing
		returning ${sql(FORM_COLUMNS as unknown as string[])}
	`;
	return rows[0] ? mapLeadForm(rows[0]) : null;
}

export async function listLeadForms(
	sql: Queryable,
	accountId: string,
	locationId: string
): Promise<LeadForm[]> {
	const rows = await sql<LeadFormRow[]>`
		select ${sql(FORM_COLUMNS as unknown as string[])}
		from lead_forms
		where account_id = ${accountId} and location_id = ${locationId}
		order by array_position(array['service', 'quote', 'appointment', 'question'], kind), id
	`;
	return rows.map(mapLeadForm);
}

export async function getLeadForm(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<LeadForm | null> {
	const rows = await sql<LeadFormRow[]>`
		select ${sql(FORM_COLUMNS as unknown as string[])}
		from lead_forms
		where account_id = ${accountId} and id = ${id}
		limit 1
	`;
	return rows[0] ? mapLeadForm(rows[0]) : null;
}

export async function getPublicLeadForm(
	sql: Queryable,
	publicKey: string
): Promise<(PublicLeadForm & { id: string; accountId: string; locationId: string; replyTemplate: string }) | null> {
	const rows = await sql<(PublicLeadFormRow & { account_id: string })[]>`
		select lf.id, lf.location_id, lf.kind, lf.public_key, lf.title, lf.intro,
			lf.reply_template, lf.consent_text, lf.enabled, lf.created_at, lf.updated_at,
			lf.account_id,
			a.name as account_name, l.name as location_name
		from lead_forms lf
		join accounts a on a.id = lf.account_id
		join locations l on l.id = lf.location_id and l.account_id = lf.account_id
		where lf.public_key = ${publicKey} and lf.enabled = true
		limit 1
	`;
	const row = rows[0];
	if (!row) return null;
	return {
		id: row.id,
		accountId: row.account_id,
		locationId: row.location_id,
		kind: row.kind,
		publicKey: row.public_key,
		title: row.title,
		intro: row.intro,
		consentText: row.consent_text,
		replyTemplate: row.reply_template,
		accountName: row.account_name,
		locationName: row.location_name
	};
}

export async function updateLeadForm(
	sql: Queryable,
	accountId: string,
	id: string,
	input: { enabled: boolean; replyTemplate: string }
): Promise<LeadForm | null> {
	const rows = await sql<LeadFormRow[]>`
		update lead_forms
		set enabled = ${input.enabled}, reply_template = ${input.replyTemplate}, updated_at = now()
		where account_id = ${accountId} and id = ${id}
		returning ${sql(FORM_COLUMNS as unknown as string[])}
	`;
	return rows[0] ? mapLeadForm(rows[0]) : null;
}

export async function insertLeadCapture(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		locationId: string;
		formId: string;
		contactId: string;
		conversationId: string;
		opportunityId: string;
		submissionKey: string;
		sourcePage: string | null;
		referrer: string | null;
		campaign: Record<string, string>;
		requestedService: string | null;
		preferredTime: string | null;
		message: string | null;
		consentText: string;
		consentedAt: Date;
		ipHash: string | null;
		userAgent: string | null;
	}
): Promise<LeadCapture | null> {
	const rows = await sql<LeadCaptureRow[]>`
		insert into lead_captures (
			id, account_id, location_id, form_id, contact_id, conversation_id, opportunity_id,
			submission_key, source_page, referrer, campaign, requested_service, preferred_time,
			message, consent_text, consented_at, ip_hash, user_agent
		)
		values (
			${row.id}, ${row.accountId}, ${row.locationId}, ${row.formId}, ${row.contactId},
			${row.conversationId}, ${row.opportunityId}, ${row.submissionKey}, ${row.sourcePage},
			${row.referrer}, ${sql.json(row.campaign as never)}, ${row.requestedService},
			${row.preferredTime}, ${row.message}, ${row.consentText}, ${row.consentedAt},
			${row.ipHash}, ${row.userAgent}
		)
		on conflict (form_id, submission_key) do nothing
		returning id, location_id, form_id, contact_id, conversation_id, opportunity_id,
			source_page, referrer, campaign, requested_service, preferred_time, message,
			consented_at, created_at
	`;
	return rows[0] ? mapCapture(rows[0]) : null;
}

export async function getLeadCaptureBySubmissionKey(
	sql: Queryable,
	accountId: string,
	formId: string,
	submissionKey: string
): Promise<LeadCapture | null> {
	const rows = await sql<LeadCaptureRow[]>`
		select id, location_id, form_id, contact_id, conversation_id, opportunity_id,
			source_page, referrer, campaign, requested_service, preferred_time, message,
			consented_at, created_at
		from lead_captures
		where account_id = ${accountId} and form_id = ${formId} and submission_key = ${submissionKey}
		limit 1
	`;
	return rows[0] ? mapCapture(rows[0]) : null;
}

export async function countRecentLeadCaptures(
	sql: Queryable,
	accountId: string,
	locationId: string
): Promise<number> {
	const rows = await sql<{ count: string | number }[]>`
		select count(*) as count
		from lead_captures
		where account_id = ${accountId} and location_id = ${locationId}
			and created_at >= now() - interval '30 days'
	`;
	return Number(rows[0]?.count ?? 0);
}

export async function countRecentLeadCapturesByIpHash(
	sql: Queryable,
	accountId: string,
	ipHash: string,
	since: Date
): Promise<number> {
	const rows = await sql<{ count: string | number }[]>`
		select count(*) as count
		from lead_captures
		where account_id = ${accountId} and ip_hash = ${ipHash} and created_at >= ${since}
	`;
	return Number(rows[0]?.count ?? 0);
}
