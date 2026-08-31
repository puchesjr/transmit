import { getSql } from '$lib/server/db';
import { api, jsonOk } from '$lib/server/http';
import { clearSessionCookie, revokeSession, SESSION_COOKIE } from '$lib/server/session';

export const POST = api(async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	if (token) {
		await revokeSession(getSql(), token);
	}
	clearSessionCookie(cookies);
	return jsonOk({ ok: true });
});
