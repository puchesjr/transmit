import { createHash } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { cookieSecure } from './env';
import { uuidv7, randomToken } from './ids';
import type { Queryable } from './db';
import type { HydratedSession } from './context';

export const SESSION_COOKIE = 'tx_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: cookieSecure(),
		maxAge
	};
}

export async function createSession(sql: Queryable, userId: string): Promise<string> {
	const token = randomToken();
	await sql`
		insert into sessions (id, user_id, token_hash, expires_at)
		values (
			${uuidv7()},
			${userId},
			${hashToken(token)},
			now() + interval '30 days'
		)
	`;
	return token;
}

export async function revokeSession(sql: Queryable, token: string): Promise<void> {
	await sql`delete from sessions where token_hash = ${hashToken(token)}`;
}

/** Every session for a user, after a password change. */
export async function revokeSessionsForUser(sql: Queryable, userId: string): Promise<void> {
	await sql`delete from sessions where user_id = ${userId}`;
}

export async function loadSession(sql: Queryable, token: string): Promise<HydratedSession | null> {
	const rows = await sql<
		{
			user_id: string;
			email: string;
			user_name: string;
			account_id: string;
			account_name: string;
			location_id: string;
			location_name: string;
			membership_id: string;
			role: 'owner' | 'member';
		}[]
	>`
		select
			u.id as user_id,
			u.email,
			u.name as user_name,
			a.id as account_id,
			a.name as account_name,
			l.id as location_id,
			l.name as location_name,
			au.id as membership_id,
			au.role
		from sessions s
		join users u on u.id = s.user_id
		join account_users au on au.user_id = u.id
		join accounts a on a.id = au.account_id
		join locations l on l.account_id = a.id and l.is_default = true
		where s.token_hash = ${hashToken(token)}
			and s.expires_at > now()
		order by au.created_at asc, au.id asc
		limit 1
	`;

	const row = rows[0];
	if (!row) return null;

	return {
		user: { id: row.user_id, email: row.email, name: row.user_name },
		account: { id: row.account_id, name: row.account_name },
		location: { id: row.location_id, name: row.location_name },
		membership: { id: row.membership_id, role: row.role }
	};
}

export function setSessionCookie(cookies: Cookies, token: string): void {
	cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
