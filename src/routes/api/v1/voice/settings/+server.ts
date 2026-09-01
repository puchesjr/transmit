import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { getVoiceSettings, parseVoiceSettings, saveVoiceSettings } from '$lib/server/domain/voice';
import { api, jsonOk, readJson } from '$lib/server/http';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	return jsonOk({ settings: await getVoiceSettings(getSql(), ctx) });
});

export const PUT = api(async ({ request, locals }) => {
	const ctx = requireAuth(locals);
	const settings = parseVoiceSettings(await readJson(request));
	return jsonOk({ settings: await saveVoiceSettings(getSql(), ctx, settings) });
});
