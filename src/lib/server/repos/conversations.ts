import type { Conversation, ConversationStatus } from '$lib/types';
import type { Queryable } from '../db';

type ConversationRow = {
	id: string;
	location_id: string;
	contact_id: string;
	phone_number_id: string;
	status: ConversationStatus;
	assignee_user_id: string | null;
	last_message_at: Date;
	snoozed_until: Date | null;
	closed_at: Date | null;
	created_at: Date;
	updated_at: Date;
};

type ConversationSummaryRow = {
	id: string;
	location_id: string;
	contact_id: string;
	status: ConversationStatus;
	assignee_user_id: string | null;
	assignee_name: string | null;
	first_name: string;
	last_name: string;
	phone: string | null;
	last_body: string;
	last_direction: 'outbound' | 'inbound';
	last_at: Date;
	unread: string | number;
};

export type ConversationRecord = {
	id: string;
	locationId: string;
	contactId: string;
	phoneNumberId: string;
	status: ConversationStatus;
	assigneeUserId: string | null;
	lastMessageAt: string;
	snoozedUntil: string | null;
	closedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

const CONVERSATION_COLUMNS = [
	'id',
	'location_id',
	'contact_id',
	'phone_number_id',
	'status',
	'assignee_user_id',
	'last_message_at',
	'snoozed_until',
	'closed_at',
	'created_at',
	'updated_at'
] as const;

function mapConversation(row: ConversationRow): ConversationRecord {
	return {
		id: row.id,
		locationId: row.location_id,
		contactId: row.contact_id,
		phoneNumberId: row.phone_number_id,
		status: row.status,
		assigneeUserId: row.assignee_user_id,
		lastMessageAt: row.last_message_at.toISOString(),
		snoozedUntil: row.snoozed_until?.toISOString() ?? null,
		closedAt: row.closed_at?.toISOString() ?? null,
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString()
	};
}

function mapConversationSummary(row: ConversationSummaryRow): Conversation {
	return {
		id: row.id,
		locationId: row.location_id,
		contactId: row.contact_id,
		status: row.status,
		assigneeUserId: row.assignee_user_id,
		assigneeName: row.assignee_name,
		firstName: row.first_name,
		lastName: row.last_name,
		phone: row.phone,
		lastBody: row.last_body,
		lastDirection: row.last_direction,
		lastAt: row.last_at.toISOString(),
		unread: Number(row.unread)
	};
}

export async function findOrCreateConversation(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		locationId: string;
		contactId: string;
		phoneNumberId: string;
		assigneeUserId: string | null;
	}
): Promise<ConversationRecord> {
	const rows = await sql<ConversationRow[]>`
		insert into conversations (
			id, account_id, location_id, contact_id, phone_number_id, assignee_user_id
		)
		values (
			${row.id}, ${row.accountId}, ${row.locationId}, ${row.contactId},
			${row.phoneNumberId}, ${row.assigneeUserId}
		)
		on conflict (account_id, contact_id, phone_number_id) do update
		set status = 'open',
			assignee_user_id = coalesce(conversations.assignee_user_id, excluded.assignee_user_id),
			snoozed_until = null,
			closed_at = null,
			updated_at = now()
		returning ${sql(CONVERSATION_COLUMNS as unknown as string[])}
	`;
	return mapConversation(rows[0]);
}

export async function getConversation(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<ConversationRecord | null> {
	const rows = await sql<ConversationRow[]>`
		select ${sql(CONVERSATION_COLUMNS as unknown as string[])}
		from conversations
		where account_id = ${accountId} and id = ${id}
		limit 1
	`;
	return rows[0] ? mapConversation(rows[0]) : null;
}

export async function touchConversation(
	sql: Queryable,
	accountId: string,
	id: string,
	at: Date
): Promise<void> {
	await sql`
		update conversations
		set status = 'open', last_message_at = greatest(last_message_at, ${at}), snoozed_until = null,
			closed_at = null, updated_at = now()
		where account_id = ${accountId} and id = ${id}
	`;
}

export async function listConversations(
	sql: Queryable,
	accountId: string
): Promise<Conversation[]> {
	const rows = await sql<ConversationSummaryRow[]>`
		select cv.id, cv.location_id, cv.contact_id, cv.status, cv.assignee_user_id,
			u.name as assignee_name, c.first_name, c.last_name, c.phone,
			lm.body as last_body, lm.direction as last_direction, lm.created_at as last_at,
			(
				select count(*) from messages unread_message
				where unread_message.account_id = cv.account_id
					and unread_message.conversation_id = cv.id
					and unread_message.direction = 'inbound'
					and unread_message.read_at is null
			) as unread
		from conversations cv
		join contacts c on c.id = cv.contact_id and c.account_id = cv.account_id
		left join account_users au
			on au.account_id = cv.account_id and au.user_id = cv.assignee_user_id
		left join users u on u.id = au.user_id
		join lateral (
			select body, direction, created_at
			from messages latest_message
			where latest_message.account_id = cv.account_id
				and latest_message.conversation_id = cv.id
			order by latest_message.created_at desc, latest_message.id desc
			limit 1
		) lm on true
		where cv.account_id = ${accountId}
		order by cv.last_message_at desc, cv.id desc
		limit 100
	`;
	return rows.map(mapConversationSummary);
}

export async function getConversationSummary(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<Conversation | null> {
	const rows = await sql<ConversationSummaryRow[]>`
		select cv.id, cv.location_id, cv.contact_id, cv.status, cv.assignee_user_id,
			u.name as assignee_name, c.first_name, c.last_name, c.phone,
			lm.body as last_body, lm.direction as last_direction, lm.created_at as last_at,
			(
				select count(*) from messages unread_message
				where unread_message.account_id = cv.account_id
					and unread_message.conversation_id = cv.id
					and unread_message.direction = 'inbound'
					and unread_message.read_at is null
			) as unread
		from conversations cv
		join contacts c on c.id = cv.contact_id and c.account_id = cv.account_id
		left join account_users au
			on au.account_id = cv.account_id and au.user_id = cv.assignee_user_id
		left join users u on u.id = au.user_id
		join lateral (
			select body, direction, created_at
			from messages latest_message
			where latest_message.account_id = cv.account_id
				and latest_message.conversation_id = cv.id
			order by latest_message.created_at desc, latest_message.id desc
			limit 1
		) lm on true
		where cv.account_id = ${accountId} and cv.id = ${id}
		limit 1
	`;
	return rows[0] ? mapConversationSummary(rows[0]) : null;
}

export async function getLatestConversationForContact(
	sql: Queryable,
	accountId: string,
	contactId: string
): Promise<ConversationRecord | null> {
	const rows = await sql<ConversationRow[]>`
		select ${sql(CONVERSATION_COLUMNS as unknown as string[])}
		from conversations
		where account_id = ${accountId} and contact_id = ${contactId}
		order by last_message_at desc, id desc
		limit 1
	`;
	return rows[0] ? mapConversation(rows[0]) : null;
}
