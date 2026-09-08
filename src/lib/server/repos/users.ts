import type { Queryable } from '../db';

export type UserRow = {
	id: string;
	email: string;
	password_hash: string;
	name: string;
};

export async function insertUser(
	sql: Queryable,
	row: { id: string; email: string; passwordHash: string; name: string }
): Promise<void> {
	await sql`
		insert into users (id, email, password_hash, name)
		values (${row.id}, ${row.email}, ${row.passwordHash}, ${row.name})
	`;
}

export async function findUserByEmail(sql: Queryable, email: string): Promise<UserRow | null> {
	const rows = await sql<UserRow[]>`
		select id, email, password_hash, name
		from users
		where lower(email) = ${email.toLowerCase()}
		limit 1
	`;
	return rows[0] ?? null;
}

export async function findUserById(sql: Queryable, id: string): Promise<UserRow | null> {
	const rows = await sql<UserRow[]>`
		select id, email, password_hash, name
		from users
		where id = ${id}
		limit 1
	`;
	return rows[0] ?? null;
}

export async function updateUserPassword(
	sql: Queryable,
	userId: string,
	passwordHash: string
): Promise<void> {
	await sql`
		update users
		set password_hash = ${passwordHash}, updated_at = now()
		where id = ${userId}
	`;
}
