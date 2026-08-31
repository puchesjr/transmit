import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { getContactDetail } from '$lib/server/domain/contacts';
import { api, jsonOk } from '$lib/server/http';
import { parseId } from '$lib/server/validation';

export const GET = api(async ({ locals, params }) => {
	const ctx = requireAuth(locals);
	const detail = await getContactDetail(getSql(), ctx, parseId(params.id));
	return jsonOk(detail);
});
