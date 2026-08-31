import { getSql } from '$lib/server/db';
import { parseSignup, signup } from '$lib/server/domain/auth';
import { api, jsonOk, readJson } from '$lib/server/http';
import { setSessionCookie } from '$lib/server/session';

export const POST = api(async ({ request, cookies }) => {
	const input = parseSignup(await readJson(request));
	const result = await signup(getSql(), input);
	setSessionCookie(cookies, result.token);
	return jsonOk(
		{
			user: result.user,
			account: result.account,
			location: result.location
		},
		201
	);
});
