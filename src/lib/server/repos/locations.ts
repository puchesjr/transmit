import type { Queryable } from '../db';

export type LocationRow = {
	id: string;
	account_id: string;
	name: string;
	is_default: boolean;
};

export async function insertLocation(
	sql: Queryable,
	row: { id: string; accountId: string; name: string; isDefault: boolean }
): Promise<void> {
	await sql`
		insert into locations (id, account_id, name, is_default)
		values (${row.id}, ${row.accountId}, ${row.name}, ${row.isDefault})
	`;
}

export async function getLocation(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<LocationRow | null> {
	const rows = await sql<LocationRow[]>`
		select id, account_id, name, is_default
		from locations
		where account_id = ${accountId} and id = ${id}
		limit 1
	`;
	return rows[0] ?? null;
}

export async function getDefaultLocation(sql: Queryable, accountId: string): Promise<LocationRow | null> {
	const rows = await sql<LocationRow[]>`
		select id, account_id, name, is_default
		from locations
		where account_id = ${accountId} and is_default = true
		limit 1
	`;
	return rows[0] ?? null;
}
