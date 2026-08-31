import type { Conversation, Message } from '$lib/types';
import type { Queryable } from '../db';

type MessageRow = {
	id: string;
	contact_id: string;
	direction: 'outbound' | 'inbound';
	body: string;
	status: Message['status'];
	not_before: Date | null;
	created_at: Date;
};

const MESSAGE_COLUMNS = ['id', 'contact_id', 'direction', 'body', 'status', 'not_before', 'created_at'] as const;

function mapMessage(row: MessageRow): Message {
	return {
		id: row.id,
		contactId: row.contact_id,
		direction: row.direction,
		body: row.body,
		status: row.status,
		notBefore: row.not_before?.toISOString() ?? null,
		createdAt: row.created_at.toISOString()
	};
}

export async function insertMessage(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		locationId: string;
		contactId: string;
		phoneNumberId: string;
		direction: 'outbound' | 'inbound';
		body: string;
		status: Message['status'];
		providerMessageId: string | null;
		notBefore: Date | null;
		createdBy: string | null;
	}
): Promise<Message | null> {
	const rows = await sql<MessageRow[]>`
		insert into messages (
			id, account_id, location_id, contact_id, phone_number_id,
			direction, body, status, provider_message_id, not_before, created_by
		)
		values (
			${row.id}, ${row.accountId}, ${row.locationId}, ${row.contactId}, ${row.phoneNumberId},
			${row.direction}, ${row.body}, ${row.status}, ${row.providerMessageId}, ${row.notBefore},
			${row.createdBy}
		)
		on conflict (provider_message_id) where provider_message_id is not null do nothing
		returning ${sql(MESSAGE_COLUMNS as unknown as string[])}
	`;
	return rows[0] ? mapMessage(rows[0]) : null;
}

export async function listMessagesForContact(
	sql: Queryable,
	accountId: string,
	contactId: string
): Promise<Message[]> {
	const rows = await sql<MessageRow[]>`
		select ${sql(MESSAGE_COLUMNS as unknown as string[])}
		from messages
		where account_id = ${accountId} and contact_id = ${contactId}
		order by created_at asc, id asc
		limit 500
	`;
	return rows.map(mapMessage);
}

export async function getMessageForSend(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<{
	message: Message;
	fromE164: string;
	toPhone: string | null;
	consent: string;
} | null> {
	const rows = await sql<
		(MessageRow & { e164: string; contact_phone: string | null; messaging_consent: string })[]
	>`
		select m.id, m.contact_id, m.direction, m.body, m.status, m.not_before, m.created_at,
			p.e164, c.phone as contact_phone, c.messaging_consent
		from messages m
		join phone_numbers p on p.id = m.phone_number_id and p.account_id = m.account_id
		join contacts c on c.id = m.contact_id and c.account_id = m.account_id
		where m.account_id = ${accountId} and m.id = ${id}
		limit 1
	`;
	const row = rows[0];
	if (!row) return null;
	return {
		message: mapMessage(row),
		fromE164: row.e164,
		toPhone: row.contact_phone,
		consent: row.messaging_consent
	};
}

export async function markMessageSent(
	sql: Queryable,
	accountId: string,
	id: string,
	providerMessageId: string
): Promise<void> {
	await sql`
		update messages
		set status = 'sent', provider_message_id = ${providerMessageId}, updated_at = now()
		where account_id = ${accountId} and id = ${id} and status = 'queued'
	`;
}

export async function markMessageFailed(
	sql: Queryable,
	accountId: string,
	id: string,
	error: string
): Promise<void> {
	await sql`
		update messages
		set status = 'failed', error = ${error.slice(0, 500)}, updated_at = now()
		where account_id = ${accountId} and id = ${id} and status = 'queued'
	`;
}

export async function updateMessageStatusByProviderId(
	sql: Queryable,
	providerMessageId: string,
	status: 'sent' | 'delivered' | 'failed',
	error: string | null
): Promise<void> {
	// Delivery webhooks are keyed by the globally-unique provider id; never regress a delivered message.
	await sql`
		update messages
		set status = ${status}, error = ${error}, updated_at = now()
		where provider_message_id = ${providerMessageId}
			and direction = 'outbound'
			and status <> 'delivered'
	`;
}

export async function markConversationRead(
	sql: Queryable,
	accountId: string,
	contactId: string
): Promise<void> {
	await sql`
		update messages
		set read_at = now()
		where account_id = ${accountId} and contact_id = ${contactId}
			and direction = 'inbound' and read_at is null
	`;
}

export async function listConversations(sql: Queryable, accountId: string): Promise<Conversation[]> {
	const rows = await sql<
		{
			contact_id: string;
			first_name: string;
			last_name: string;
			phone: string | null;
			last_body: string;
			last_direction: 'outbound' | 'inbound';
			last_at: Date;
			unread: string | number;
		}[]
	>`
		select c.id as contact_id, c.first_name, c.last_name, c.phone,
			lm.body as last_body, lm.direction as last_direction, lm.created_at as last_at,
			(
				select count(*) from messages u
				where u.account_id = c.account_id and u.contact_id = c.id
					and u.direction = 'inbound' and u.read_at is null
			) as unread
		from contacts c
		join lateral (
			select body, direction, created_at
			from messages m
			where m.account_id = c.account_id and m.contact_id = c.id
			order by m.created_at desc, m.id desc
			limit 1
		) lm on true
		where c.account_id = ${accountId}
		order by lm.created_at desc
		limit 100
	`;
	return rows.map((row) => ({
		contactId: row.contact_id,
		firstName: row.first_name,
		lastName: row.last_name,
		phone: row.phone,
		lastBody: row.last_body,
		lastDirection: row.last_direction,
		lastAt: row.last_at.toISOString(),
		unread: Number(row.unread)
	}));
}
