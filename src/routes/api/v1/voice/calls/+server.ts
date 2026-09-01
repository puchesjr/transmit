import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { listAccountCalls } from '$lib/server/domain/voice';
import { api, jsonOk } from '$lib/server/http';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	return jsonOk({ calls: await listAccountCalls(getSql(), ctx) });
});
