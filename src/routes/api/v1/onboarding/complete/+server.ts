import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { finishOnboarding, parseOnboardingAction } from '$lib/server/domain/onboarding';
import { api, jsonOk, readJson } from '$lib/server/http';

export const POST = api(async ({ request, locals }) => {
	const ctx = requireAuth(locals);
	const action = parseOnboardingAction(await readJson(request));
	return jsonOk(await finishOnboarding(getSql(), ctx, action));
});
