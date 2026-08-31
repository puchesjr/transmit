import type { Contact } from '$lib/types';
import type { Queryable } from '../db';

type ContactRow = {
	id: string;
	location_id: string;
	first_name: string;
	last_name: string;
	email: string | null;
	phone: string | null;
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
		createdBy: string;
	}
): Promise<Contact> {
	const rows = await sql<ContactRow[]>`
		insert into contacts (
			id, account_id, location_id, first_name, last_name, email, phone, created_by
		)
		values (
			${row.id},
			${row.accountId},
			${row.locationId},
			${row.firstName},
			${row.lastName},
			${row.email},
			${row.phone},
			${row.createdBy}
		)
		returning id, location_id, first_name, last_name, email, phone, created_at, updated_at
	`;
	return mapContact(rows[0]);
}

export async function listContacts(sql: Queryable, accountId: string): Promise<Contact[]> {
	const rows = await sql<ContactRow[]>`
		select id, location_id, first_name, last_name, email, phone, created_at, updated_at
		from contacts
		where account_id = ${accountId}
		order by created_at desc, id desc
		limit 200
	`;
	return rows.map(mapContact);
}

export async function getContact(sql: Queryable, accountId: string, id: string): Promise<Contact | null> {
	const rows = await sql<ContactRow[]>`
		select id, location_id, first_name, last_name, email, phone, created_at, updated_at
		from contacts
		where account_id = ${accountId} and id = ${id}
		limit 1
	`;
	return rows[0] ? mapContact(rows[0]) : null;
}
