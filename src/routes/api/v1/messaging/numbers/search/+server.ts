import { requireAuth } from '$lib/server/context';
import { parseSearchNumbers, searchAvailableNumbers } from '$lib/server/domain/messaging';
import { api, jsonOk, readJson } from '$lib/server/http';
import { getMessagingProvider } from '$lib/server/providers/messaging';

export const POST = api(async ({ request, locals }) => {
	requireAuth(locals);
	const { areaCode } = parseSearchNumbers(await readJson(request));
	const provider = await getMessagingProvider();
	return jsonOk({ numbers: await searchAvailableNumbers(provider, areaCode) });
});
