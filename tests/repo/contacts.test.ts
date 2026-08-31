import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import { createContact } from '$lib/server/domain/contacts';
import { getContact, listContacts } from '$lib/server/repos/contacts';
import { authContext, createWorkspace } from '../helpers';

describe('contact repository', () => {
	it('lists and fetches contacts only for the given account_id', async () => {
		const sql = getSql();
		const alpha = await createWorkspace('alpha');
		const beta = await createWorkspace('beta');

		const contact = await createContact(sql, authContext(alpha), {
			firstName: 'Alpha',
			lastName: 'Person',
			email: 'alpha@example.com',
			phone: null
		});

		const alphaList = await listContacts(sql, alpha.account.id);
		const betaList = await listContacts(sql, beta.account.id);

		expect(alphaList.map((row) => row.id)).toEqual([contact.id]);
		expect(betaList).toEqual([]);
		expect(await getContact(sql, alpha.account.id, contact.id)).not.toBeNull();
		expect(await getContact(sql, beta.account.id, contact.id)).toBeNull();
	});
});
