import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { importContactsCsv, parseContactImport } from '$lib/server/domain/contact-import';
import { api, jsonOk, readJson } from '$lib/server/http';

export const POST = api(async ({ locals, request }) => {
	const ctx = requireAuth(locals);
	const { csv } = parseContactImport(await readJson(request));
	return jsonOk({ result: await importContactsCsv(getSql(), ctx, csv) });
});
