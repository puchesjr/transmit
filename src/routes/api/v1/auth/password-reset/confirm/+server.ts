import { getSql } from '$lib/server/db';
import { confirmPasswordReset, parsePasswordResetConfirm } from '$lib/server/domain/password-reset';
import { api, jsonOk, readJson } from '$lib/server/http';
import { clearSessionCookie } from '$lib/server/session';

export const POST = api(async ({ request, cookies }) => {
	const input = parsePasswordResetConfirm(await readJson(request));
	await confirmPasswordReset(getSql(), input);
	clearSessionCookie(cookies);
	return jsonOk({ ok: true });
});
