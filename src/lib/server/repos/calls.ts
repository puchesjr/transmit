import { contactName } from '$lib/format';
import type { Call, CallStatus } from '$lib/types';
import type { Queryable } from '../db';

type CallRow = {
	id: string;
	location_id: string;
	contact_id: string;
	provider_call_session_id: string;
	provider_call_control_id: string;
	direction: 'inbound' | 'outbound';
	status: CallStatus;
	from_e164: string;
	to_e164: string;
	started_at: Date;
	answered_at: Date | null;
	ended_at: Date | null;
	duration_seconds: number | null;
	hangup_cause: string | null;
	after_hours: boolean;
	textback_message_id: string | null;
	first_name?: string;
	last_name?: string;
	phone?: string | null;
};

export type CallRecord = {
	id: string;
	locationId: string;
	contactId: string;
	providerCallSessionId: string;
	providerCallControlId: string;
	direction: 'inbound' | 'outbound';
	status: CallStatus;
	from: string;
	to: string;
	startedAt: Date;
	answeredAt: Date | null;
	endedAt: Date | null;
	durationSeconds: number | null;
	hangupCause: string | null;
	afterHours: boolean;
	textbackMessageId: string | null;
};

const CALL_COLUMNS = [
	'id',
	'location_id',
	'contact_id',
	'provider_call_session_id',
	'provider_call_control_id',
	'direction',
	'status',
	'from_e164',
	'to_e164',
	'started_at',
	'answered_at',
	'ended_at',
	'duration_seconds',
	'hangup_cause',
	'after_hours',
	'textback_message_id'
] as const;

function mapRecord(row: CallRow): CallRecord {
	return {
		id: row.id,
		locationId: row.location_id,
		contactId: row.contact_id,
		providerCallSessionId: row.provider_call_session_id,
		providerCallControlId: row.provider_call_control_id,
		direction: row.direction,
		status: row.status,
		from: row.from_e164,
		to: row.to_e164,
		startedAt: row.started_at,
		answeredAt: row.answered_at,
		endedAt: row.ended_at,
		durationSeconds: row.duration_seconds,
		hangupCause: row.hangup_cause,
		afterHours: row.after_hours,
		textbackMessageId: row.textback_message_id
	};
}

function mapCall(row: CallRow): Call {
	return {
		id: row.id,
		locationId: row.location_id,
		contactId: row.contact_id,
		contactName: contactName({ firstName: row.first_name ?? '', lastName: row.last_name ?? '' }),
		phone: row.phone ?? null,
		direction: row.direction,
		status: row.status,
		from: row.from_e164,
		to: row.to_e164,
		startedAt: row.started_at.toISOString(),
		answeredAt: row.answered_at?.toISOString() ?? null,
		endedAt: row.ended_at?.toISOString() ?? null,
		durationSeconds: row.duration_seconds,
		hangupCause: row.hangup_cause,
		afterHours: row.after_hours,
		textbackMessageId: row.textback_message_id
	};
}

export async function insertInboundCall(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		locationId: string;
		contactId: string;
		phoneNumberId: string;
		providerCallSessionId: string;
		providerCallControlId: string;
		from: string;
		to: string;
		startedAt: Date;
		afterHours: boolean;
	}
): Promise<CallRecord> {
	const rows = await sql<CallRow[]>`
		insert into calls (
			id, account_id, location_id, contact_id, phone_number_id,
			provider_call_session_id, provider_call_control_id, direction, status,
			from_e164, to_e164, started_at, after_hours
		)
		values (
			${row.id}, ${row.accountId}, ${row.locationId}, ${row.contactId}, ${row.phoneNumberId},
			${row.providerCallSessionId}, ${row.providerCallControlId}, 'inbound', 'ringing',
			${row.from}, ${row.to}, ${row.startedAt}, ${row.afterHours}
		)
		on conflict (account_id, provider_call_session_id) do update set
			provider_call_control_id = calls.provider_call_control_id,
			updated_at = now()
		returning ${sql(CALL_COLUMNS as unknown as string[])}
	`;
	return mapRecord(rows[0]);
}

export async function getCallBySession(
	sql: Queryable,
	accountId: string,
	providerCallSessionId: string
): Promise<CallRecord | null> {
	const rows = await sql<CallRow[]>`
		select ${sql(CALL_COLUMNS as unknown as string[])}
		from calls
		where account_id = ${accountId} and provider_call_session_id = ${providerCallSessionId}
		limit 1
	`;
	return rows[0] ? mapRecord(rows[0]) : null;
}

export async function markCallForwarding(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<void> {
	await sql`
		update calls set status = 'forwarding', updated_at = now()
		where account_id = ${accountId} and id = ${id} and status = 'ringing'
	`;
}

export async function markCallAnswered(
	sql: Queryable,
	accountId: string,
	id: string,
	answeredAt: Date
): Promise<void> {
	await sql`
		update calls
		set status = 'answered', answered_at = coalesce(answered_at, ${answeredAt}), updated_at = now()
		where account_id = ${accountId} and id = ${id}
			and status in ('ringing', 'forwarding', 'answered')
	`;
}

export async function finalizeCall(
	sql: Queryable,
	accountId: string,
	id: string,
	input: {
		status: 'missed' | 'completed' | 'failed';
		endedAt: Date;
		durationSeconds: number;
		hangupCause: string | null;
	}
): Promise<CallRecord | null> {
	const rows = await sql<CallRow[]>`
		update calls
		set status = ${input.status}, ended_at = ${input.endedAt},
			duration_seconds = ${input.durationSeconds}, hangup_cause = ${input.hangupCause},
			updated_at = now()
		where account_id = ${accountId} and id = ${id}
			and status not in ('missed', 'completed', 'failed')
		returning ${sql(CALL_COLUMNS as unknown as string[])}
	`;
	return rows[0] ? mapRecord(rows[0]) : null;
}

export async function attachCallTextback(
	sql: Queryable,
	accountId: string,
	id: string,
	messageId: string
): Promise<void> {
	await sql`
		update calls set textback_message_id = ${messageId}, updated_at = now()
		where account_id = ${accountId} and id = ${id} and textback_message_id is null
	`;
}

export async function listCalls(sql: Queryable, accountId: string): Promise<Call[]> {
	const rows = await sql<CallRow[]>`
		select ${sql(CALL_COLUMNS.map((column) => `ca.${column}`))},
			c.first_name, c.last_name, c.phone
		from calls ca
		join contacts c on c.account_id = ca.account_id and c.id = ca.contact_id
		where ca.account_id = ${accountId}
		order by ca.started_at desc, ca.id desc
		limit 100
	`;
	return rows.map(mapCall);
}
