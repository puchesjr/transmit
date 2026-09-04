import type { Queryable } from '../db';

export type PasswordResetRow = {
	id: string;
	user_id: string;
	expires_at: Date;
	used_at: Date | null;
};

export async function insertPasswordReset(
	sql: Queryable,
	row: { id: string; userId: string; tokenHash: string; expiresAt: Date }
): Promise<void> {
	await sql`
		insert into password_resets (id, user_id, token_hash, expires_at)
		values (${row.id}, ${row.userId}, ${row.tokenHash}, ${row.expiresAt})
	`;
}

/** The newest request for a user inside the cooldown window, if any. */
export async function findRecentPasswordReset(
	sql: Queryable,
	userId: string,
	withinSeconds: number
): Promise<PasswordResetRow | null> {
	const rows = await sql<PasswordResetRow[]>`
		select id, user_id, expires_at, used_at
		from password_resets
		where user_id = ${userId}
			and created_at > now() - make_interval(secs => ${withinSeconds})
		order by created_at desc
		limit 1
	`;
	return rows[0] ?? null;
}

/** A reset that is unused and unexpired, by token hash. */
export async function findUsablePasswordReset(
	sql: Queryable,
	tokenHash: string
): Promise<PasswordResetRow | null> {
	const rows = await sql<PasswordResetRow[]>`
		select id, user_id, expires_at, used_at
		from password_resets
		where token_hash = ${tokenHash}
			and used_at is null
			and expires_at > now()
		limit 1
	`;
	return rows[0] ?? null;
}

export async function markPasswordResetUsed(sql: Queryable, id: string): Promise<void> {
	await sql`update password_resets set used_at = now() where id = ${id} and used_at is null`;
}
