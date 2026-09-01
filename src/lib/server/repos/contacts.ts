import type { Contact } from '$lib/types';
import type { Queryable } from '../db';

type ContactRow = {
	id: string;
	location_id: string;
	first_name: string;
	last_name: string;
	email: string | null;
	phone: string | null;
	messaging_consent: 'unknown' | 'opted_in' | 'opted_out';
	created_at: Date;
	updated_at: Date;
};

function mapContact(row: ContactRow): Contact {
	return {
		id: row.id,
		locationId: row.location_id,
		firstName: row.first_name,
		lastName: row.last_name,
		email: row.email,
		phone: row.phone,
		messagingConsent: row.messaging_consent,
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString()
	};
}

export async function insertContact(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		locationId: string;
		firstName: string;
		lastName: string;
		email: string | null;
		phone: string | null;
		messagingConsent?: 'unknown' | 'opted_in' | 'opted_out';
		createdBy: string | null;
	}
): Promise<Contact> {
	const rows = await sql<ContactRow[]>`
		insert into contacts (
			id, account_id, location_id, first_name, last_name, email, phone,
			messaging_consent, created_by
		)
		values (
			${row.id},
			${row.accountId},
			${row.locationId},
			${row.firstName},
			${row.lastName},
			${row.email},
			${row.phone},
			${row.messagingConsent ?? 'unknown'},
			${row.createdBy}
		)
		returning id, location_id, first_name, last_name, email, phone, messaging_consent, created_at, updated_at
	`;
	return mapContact(rows[0]);
}

export async function listContacts(sql: Queryable, accountId: string): Promise<Contact[]> {
	const rows = await sql<ContactRow[]>`
		select id, location_id, first_name, last_name, email, phone, messaging_consent, created_at, updated_at
		from contacts
		where account_id = ${accountId}
		order by created_at desc, id desc
		limit 200
	`;
	return rows.map(mapContact);
}

export async function getContact(sql: Queryable, accountId: string, id: string): Promise<Contact | null> {
	const rows = await sql<ContactRow[]>`
		select id, location_id, first_name, last_name, email, phone, messaging_consent, created_at, updated_at
		from contacts
		where account_id = ${accountId} and id = ${id}
		limit 1
	`;
	return rows[0] ? mapContact(rows[0]) : null;
}

export async function findContactByPhone(
	sql: Queryable,
	accountId: string,
	e164: string
): Promise<Contact | null> {
	// Match on the last 10 digits so "+15551234567" finds "(555) 123-4567".
	const digits = e164.replace(/\D/g, '').slice(-10);
	if (digits.length < 10) return null;
	const rows = await sql<ContactRow[]>`
		select id, location_id, first_name, last_name, email, phone, messaging_consent, created_at, updated_at
		from contacts
		where account_id = ${accountId}
			and right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = ${digits}
		order by created_at asc
		limit 1
	`;
	return rows[0] ? mapContact(rows[0]) : null;
}

export async function findContactByEmail(
	sql: Queryable,
	accountId: string,
	email: string
): Promise<Contact | null> {
	const rows = await sql<ContactRow[]>`
		select id, location_id, first_name, last_name, email, phone, messaging_consent, created_at, updated_at
		from contacts
		where account_id = ${accountId} and lower(email) = lower(${email})
		order by created_at asc, id asc
		limit 1
	`;
	return rows[0] ? mapContact(rows[0]) : null;
}

export async function updateContactFromCapture(
	sql: Queryable,
	accountId: string,
	contactId: string,
	input: {
		locationId: string;
		firstName: string;
		lastName: string;
		email: string | null;
		phone: string;
	}
): Promise<Contact | null> {
	const rows = await sql<ContactRow[]>`
		update contacts
		set location_id = ${input.locationId},
			first_name = case when trim(first_name) = '' then ${input.firstName} else first_name end,
			last_name = case when trim(last_name) = '' then ${input.lastName} else last_name end,
			email = coalesce(email, ${input.email}),
			phone = coalesce(phone, ${input.phone}),
			messaging_consent = 'opted_in',
			updated_at = now()
		where account_id = ${accountId} and id = ${contactId}
		returning id, location_id, first_name, last_name, email, phone, messaging_consent, created_at, updated_at
	`;
	return rows[0] ? mapContact(rows[0]) : null;
}

export async function updateContactConsent(
	sql: Queryable,
	accountId: string,
	contactId: string,
	consent: 'opted_in' | 'opted_out'
): Promise<void> {
	await sql`
		update contacts
		set messaging_consent = ${consent}, updated_at = now()
		where account_id = ${accountId} and id = ${contactId}
	`;
}
