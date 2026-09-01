import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import {
	generateReplySuggestions,
	getLatestReplySuggestions
} from '$lib/server/domain/ai';
import { api, jsonOk } from '$lib/server/http';
import { getAiProvider } from '$lib/server/providers/ai';
import { parseId } from '$lib/server/validation';

export const GET = api(async ({ locals, params }) => {
	const ctx = requireAuth(locals);
	const artifact = await getLatestReplySuggestions(getSql(), ctx, parseId(params.id));
	return jsonOk({ artifact });
});

export const POST = api(async ({ locals, params }) => {
	const ctx = requireAuth(locals);
	const artifact = await generateReplySuggestions(
		getSql(),
		await getAiProvider(),
		ctx,
		parseId(params.id)
	);
	return jsonOk({ artifact }, 201);
});
