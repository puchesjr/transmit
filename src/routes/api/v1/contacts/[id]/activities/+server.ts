import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { getContactTimeline } from '$lib/server/domain/contacts';
import { api, jsonOk } from '$lib/server/http';
import { parseId } from '$lib/server/validation';

export const GET = api(async ({ locals, params }) => {
	const ctx = requireAuth(locals);
	const activities = await getContactTimeline(getSql(), ctx, parseId(params.id));
	return jsonOk({ activities });
});
