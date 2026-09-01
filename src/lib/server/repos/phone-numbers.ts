import type { PhoneNumber } from '$lib/types';
import type { Queryable } from '../db';

type PhoneNumberRow = {
	id: string;
	location_id: string;
	e164: string;
	status: 'active' | 'released';
	created_at: Date;
};

function mapPhoneNumber(row: PhoneNumberRow): PhoneNumber {
	return {
		id: row.id,
		locationId: row.location_id,
		e164: row.e164,
		status: row.status,
		createdAt: row.created_at.toISOString()
	};
}

export async function insertPhoneNumber(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		locationId: string;
		e164: string;
		providerNumberId: string | null;
	}
): Promise<PhoneNumber> {
	const rows = await sql<PhoneNumberRow[]>`
		insert into phone_numbers (id, account_id, location_id, e164, provider_number_id, status)
		values (${row.id}, ${row.accountId}, ${row.locationId}, ${row.e164}, ${row.providerNumberId}, 'active')
		returning id, location_id, e164, status, created_at
	`;
	return mapPhoneNumber(rows[0]);
}

export async function listPhoneNumbers(sql: Queryable, accountId: string): Promise<PhoneNumber[]> {
	const rows = await sql<PhoneNumberRow[]>`
		select id, location_id, e164, status, created_at
		from phone_numbers
		where account_id = ${accountId} and status = 'active'
		order by created_at asc
	`;
	return rows.map(mapPhoneNumber);
}

export async function getActiveNumberForLocation(
	sql: Queryable,
	accountId: string,
	locationId: string
): Promise<PhoneNumber | null> {
	const rows = await sql<PhoneNumberRow[]>`
		select id, location_id, e164, status, created_at
		from phone_numbers
		where account_id = ${accountId} and location_id = ${locationId} and status = 'active'
		limit 1
	`;
	return rows[0] ? mapPhoneNumber(rows[0]) : null;
}

export async function findNumberByE164(
	sql: Queryable,
	e164: string
): Promise<{ id: string; accountId: string; locationId: string; e164: string } | null> {
	// Webhook entry point: the inbound "to" number is how we discover the tenant.
	const rows = await sql<{ id: string; account_id: string; location_id: string }[]>`
		select id, account_id, location_id
		from phone_numbers
		where e164 = ${e164} and status = 'active'
		limit 1
	`;
	const row = rows[0];
	return row
		? { id: row.id, accountId: row.account_id, locationId: row.location_id, e164 }
		: null;
}
