import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { associateCompanyToContact, parseAssociateCompany } from '$lib/server/domain/companies';
import { api, jsonOk, readJson } from '$lib/server/http';
import { parseId } from '$lib/server/validation';

export const POST = api(async ({ request, locals, params }) => {
	const ctx = requireAuth(locals);
	const { companyId } = parseAssociateCompany(await readJson(request));
	const result = await associateCompanyToContact(getSql(), ctx, parseId(params.id), companyId);
	return jsonOk(result);
});
