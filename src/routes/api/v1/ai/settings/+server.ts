import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import {
	getAccountAiSettings,
	parseAiSettings,
	saveAccountAiSettings
} from '$lib/server/domain/ai';
import { api, jsonOk, readJson } from '$lib/server/http';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	return jsonOk({ settings: await getAccountAiSettings(getSql(), ctx) });
});

export const PUT = api(async ({ request, locals }) => {
	const ctx = requireAuth(locals);
	const settings = parseAiSettings(await readJson(request));
	return jsonOk({ settings: await saveAccountAiSettings(getSql(), ctx, settings) });
});
