import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { parseArtifactUse, useAiArtifact } from '$lib/server/domain/ai';
import { api, jsonOk, readJson } from '$lib/server/http';
import { parseId } from '$lib/server/validation';

export const POST = api(async ({ request, locals, params }) => {
	const ctx = requireAuth(locals);
	const { choiceIndex } = parseArtifactUse(await readJson(request));
	return jsonOk(await useAiArtifact(getSql(), ctx, parseId(params.id), choiceIndex));
});
