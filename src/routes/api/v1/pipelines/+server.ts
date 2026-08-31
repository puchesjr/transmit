import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { listAccountPipelines } from '$lib/server/domain/opportunities';
import { api, jsonOk } from '$lib/server/http';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	const pipelines = await listAccountPipelines(getSql(), ctx);
	return jsonOk({ pipelines });
});
