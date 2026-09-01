import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { markContactThreadRead } from '$lib/server/domain/messaging';
import { api, jsonOk } from '$lib/server/http';
import { parseId } from '$lib/server/validation';

export const POST = api(async ({ locals, params }) => {
	const ctx = requireAuth(locals);
	await markContactThreadRead(getSql(), ctx, parseId(params.id));
	return jsonOk({ ok: true });
});
