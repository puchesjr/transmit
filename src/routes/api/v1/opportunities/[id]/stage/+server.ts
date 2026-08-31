import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { moveOpportunityStage, parseMoveStage } from '$lib/server/domain/opportunities';
import { api, jsonOk, readJson } from '$lib/server/http';
import { parseId } from '$lib/server/validation';

export const POST = api(async ({ request, locals, params }) => {
	const ctx = requireAuth(locals);
	const { stageId } = parseMoveStage(await readJson(request));
	const opportunity = await moveOpportunityStage(getSql(), ctx, parseId(params.id), stageId);
	return jsonOk({ opportunity });
});
