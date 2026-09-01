import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { getLeadCaptureSettings } from '$lib/server/domain/lead-capture';
import { api, jsonOk } from '$lib/server/http';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	return jsonOk(await getLeadCaptureSettings(getSql(), ctx));
});
