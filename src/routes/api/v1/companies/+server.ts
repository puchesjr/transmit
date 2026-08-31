import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { createCompany, listAccountCompanies, parseCreateCompany } from '$lib/server/domain/companies';
import { api, jsonOk, readJson } from '$lib/server/http';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	const companies = await listAccountCompanies(getSql(), ctx);
	return jsonOk({ companies });
});

export const POST = api(async ({ request, locals }) => {
	const ctx = requireAuth(locals);
	const input = parseCreateCompany(await readJson(request));
	const company = await createCompany(getSql(), ctx, input);
	return jsonOk({ company }, 201);
});
