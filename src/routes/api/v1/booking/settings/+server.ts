import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import {
	editBookingSettings,
	getAccountBookingSettings,
	parseBookingSettings
} from '$lib/server/domain/booking';
import { api, jsonOk, readJson } from '$lib/server/http';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	return jsonOk(await getAccountBookingSettings(getSql(), ctx));
});

export const PUT = api(async ({ locals, request }) => {
	const ctx = requireAuth(locals);
	return jsonOk({
		settings: await editBookingSettings(
			getSql(),
			ctx,
			parseBookingSettings(await readJson(request))
		)
	});
});
