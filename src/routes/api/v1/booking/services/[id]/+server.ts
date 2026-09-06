import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { editBookingService, parseBookingService } from '$lib/server/domain/booking';
import { api, jsonOk, readJson } from '$lib/server/http';
import { parseId } from '$lib/server/validation';

export const PUT = api(async ({ locals, request, params }) => {
	const ctx = requireAuth(locals);
	return jsonOk({
		service: await editBookingService(
			getSql(),
			ctx,
			parseId(params.id),
			parseBookingService(await readJson(request))
		)
	});
});
