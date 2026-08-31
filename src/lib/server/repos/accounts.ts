import type { Queryable } from '../db';

export async function insertAccount(sql: Queryable, row: { id: string; name: string }): Promise<void> {
	await sql`
		insert into accounts (id, name)
		values (${row.id}, ${row.name})
	`;
}

export async function insertAccountUser(
	sql: Queryable,
	row: { id: string; accountId: string; userId: string; role: 'owner' | 'member' }
): Promise<void> {
	await sql`
		insert into account_users (id, account_id, user_id, role)
		values (${row.id}, ${row.accountId}, ${row.userId}, ${row.role})
	`;
}
