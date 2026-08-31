import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { createContact, listAccountContacts, parseCreateContact } from '$lib/server/domain/contacts';
import { api, jsonOk, readJson } from '$lib/server/http';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	const contacts = await listAccountContacts(getSql(), ctx);
	return jsonOk({ contacts });
});

export const POST = api(async ({ request, locals }) => {
	const ctx = requireAuth(locals);
	const input = parseCreateContact(await readJson(request));
	const contact = await createContact(getSql(), ctx, input);
	return jsonOk({ contact }, 201);
});
