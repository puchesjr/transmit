import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import { createContact, getContactDetail, getContactTimeline } from '$lib/server/domain/contacts';
import { AppError } from '$lib/server/errors';
import { getContact } from '$lib/server/repos/contacts';
import { authContext, createWorkspace } from '../helpers';

describe('contact create', () => {
	it('creates a contact and writes a timeline activity', async () => {
		const workspace = await createWorkspace('contact');
		const ctx = authContext(workspace);
		const contact = await createContact(getSql(), ctx, {
			firstName: 'Charles',
			lastName: 'Babbage',
			email: 'charles@example.com',
			phone: null
		});

		expect(contact.firstName).toBe('Charles');
		expect(contact.lastName).toBe('Babbage');

		const detail = await getContactDetail(getSql(), ctx, contact.id);
		expect(detail.contact.id).toBe(contact.id);

		const timeline = await getContactTimeline(getSql(), ctx, contact.id);
		expect(timeline[0]?.type).toBe('contact.created');
		expect(timeline[0]?.summary).toContain('Charles Babbage');
	});

	it('requires a first or last name', async () => {
		const ctx = authContext(await createWorkspace('noname'));
		await expect(
			createContact(getSql(), ctx, {
				firstName: '',
				lastName: '',
				email: 'nobody@example.com',
				phone: null
			})
		).rejects.toMatchObject({ code: 'validation' } satisfies Partial<AppError>);
	});

	it('cannot be read from another account', async () => {
		const owner = await createWorkspace('owner');
		const other = await createWorkspace('other');
		const contact = await createContact(getSql(), authContext(owner), {
			firstName: 'Secret',
			lastName: 'Lead',
			email: null,
			phone: null
		});

		const leaked = await getContact(getSql(), other.account.id, contact.id);
		expect(leaked).toBeNull();
		await expect(getContactDetail(getSql(), authContext(other), contact.id)).rejects.toMatchObject({
			code: 'not_found'
		} satisfies Partial<AppError>);
	});
});
