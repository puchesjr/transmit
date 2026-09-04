import { getSql } from '$lib/server/db';
import { parsePasswordResetRequest, requestPasswordReset } from '$lib/server/domain/password-reset';
import { api, jsonOk, readJson } from '$lib/server/http';
import { log } from '$lib/server/logger';
import { getEmailProvider } from '$lib/server/providers/email';
import { getPublicSiteUrl } from '$lib/server/site';

/** Same answer whether or not the address has an account. */
export const POST = api(async ({ request, locals }) => {
	const input = parsePasswordResetRequest(await readJson(request));
	const { sent } = await requestPasswordReset(getSql(), await getEmailProvider(), {
		email: input.email,
		siteUrl: getPublicSiteUrl()
	});
	log('info', 'password_reset_requested', { requestId: locals.requestId, sent });
	return jsonOk({ accepted: true }, 202);
});
