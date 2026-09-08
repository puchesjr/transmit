import type { Queryable } from '../db';
import { uuidv7 } from '../ids';

export async function countRecentAuthAttempts(
	sql: Queryable,
	action: 'signin' | 'signup',
	keyHash: string,
	since: Date
): Promise<number> {
	const rows = await sql<{ count: number }[]>`
		select count(*)::int as count
		from auth_attempts
		where action = ${action} and key_hash = ${keyHash} and created_at >= ${since}
	`;
	return rows[0]?.count ?? 0;
}

export async function insertAuthAttempt(
	sql: Queryable,
	action: 'signin' | 'signup',
	keyHash: string
): Promise<void> {
	await sql`
		insert into auth_attempts (id, action, key_hash)
		values (${uuidv7()}, ${action}, ${keyHash})
	`;
}
