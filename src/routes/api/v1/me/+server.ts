import { requireAuth } from '$lib/server/context';
import { currentUser } from '$lib/server/domain/auth';
import { api, jsonOk } from '$lib/server/http';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	return jsonOk(currentUser(ctx, locals));
});
