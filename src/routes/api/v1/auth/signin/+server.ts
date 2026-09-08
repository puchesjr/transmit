import { getSql } from '$lib/server/db';
import { parseSignin, signin } from '$lib/server/domain/auth';
import { api, clientIp, jsonOk, readJson } from '$lib/server/http';
import { setSessionCookie } from '$lib/server/session';

export const POST = api(async (event) => {
	const input = parseSignin(await readJson(event.request));
	const result = await signin(getSql(), input, { ip: clientIp(event) });
	setSessionCookie(event.cookies, result.token);
	return jsonOk({
		user: result.user,
		account: result.account,
		location: result.location
	});
});
