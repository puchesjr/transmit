import { json } from '@sveltejs/kit';
import { pingSql } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const ready = await pingSql();
	if (!ready) {
		return json(
			{ status: 'not_ready', request_id: locals.requestId },
			{ status: 503 }
		);
	}
	return json({ status: 'ready' });
};
