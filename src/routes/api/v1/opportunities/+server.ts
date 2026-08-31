import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import {
	createOpportunity,
	listAccountOpportunities,
	parseCreateOpportunity
} from '$lib/server/domain/opportunities';
import { api, jsonOk, readJson } from '$lib/server/http';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	return jsonOk(await listAccountOpportunities(getSql(), ctx));
});

export const POST = api(async ({ request, locals }) => {
	const ctx = requireAuth(locals);
	const input = parseCreateOpportunity(await readJson(request));
	const opportunity = await createOpportunity(getSql(), ctx, input);
	return jsonOk({ opportunity }, 201);
});
