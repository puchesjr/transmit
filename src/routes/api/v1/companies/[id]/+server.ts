import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { getCompanyDetail } from '$lib/server/domain/companies';
import { api, jsonOk } from '$lib/server/http';
import { parseId } from '$lib/server/validation';

export const GET = api(async ({ locals, params }) => {
	const ctx = requireAuth(locals);
	const detail = await getCompanyDetail(getSql(), ctx, parseId(params.id));
	return jsonOk(detail);
});
