import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { listAccountFollowUpDrafts } from '$lib/server/domain/ai';
import { api, jsonOk } from '$lib/server/http';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	return jsonOk({ artifacts: await listAccountFollowUpDrafts(getSql(), ctx) });
});
