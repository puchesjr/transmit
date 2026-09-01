import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSql } from '$lib/server/db';
import { getPublicLeadCaptureForm } from '$lib/server/domain/lead-capture';

export const load: PageServerLoad = async ({ params }) => {
	const loaded = await getPublicLeadCaptureForm(getSql(), params.key);
	if (!loaded) error(404, 'This request form is not available.');
	const { id: _id, accountId: _accountId, locationId: _locationId, replyTemplate: _reply, ...form } = loaded;
	return { form };
};
