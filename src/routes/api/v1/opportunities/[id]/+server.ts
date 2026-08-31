import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { getOpportunityDetail } from '$lib/server/domain/opportunities';
import { api, jsonOk } from '$lib/server/http';
import { parseId } from '$lib/server/validation';

export const GET = api(async ({ locals, params }) => {
	const ctx = requireAuth(locals);
	return jsonOk(await getOpportunityDetail(getSql(), ctx, parseId(params.id)));
});
