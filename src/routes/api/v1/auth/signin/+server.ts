import { getSql } from '$lib/server/db';
import { parseSignin, signin } from '$lib/server/domain/auth';
import { api, jsonOk, readJson } from '$lib/server/http';
import { setSessionCookie } from '$lib/server/session';

export const POST = api(async ({ request, cookies }) => {
	const input = parseSignin(await readJson(request));
	const result = await signin(getSql(), input);
	setSessionCookie(cookies, result.token);
	return jsonOk({
		user: result.user,
		account: result.account,
		location: result.location
	});
});
