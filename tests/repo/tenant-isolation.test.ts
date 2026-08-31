import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import { createCompany } from '$lib/server/domain/companies';
import { createContact } from '$lib/server/domain/contacts';
import { createOpportunity, moveOpportunityStage } from '$lib/server/domain/opportunities';
import { getCompany } from '$lib/server/repos/companies';
import { getOpportunity, updateOpportunityStage } from '$lib/server/repos/opportunities';
import { listPipelines } from '$lib/server/repos/pipelines';
import { authContext, createWorkspace } from '../helpers';

describe('tenant isolation', () => {
	it('cannot update another account opportunity stage even with a known id', async () => {
		const sql = getSql();
		const seller = await createWorkspace('seller');
		const stranger = await createWorkspace('stranger');

		const opportunity = await createOpportunity(sql, authContext(seller), {
			name: 'Engine contract',
			contactId: null,
			companyId: null,
			amountCents: 100000,
			stageId: null
		});

		const strangerPipelines = await listPipelines(sql, stranger.account.id);
		const strangerStage = strangerPipelines[0]?.stages[1];
		expect(strangerStage).toBeTruthy();

		const updated = await updateOpportunityStage(
			sql,
			stranger.account.id,
			opportunity.id,
			strangerStage!.id
		);
		expect(updated).toBeNull();

		const original = await getOpportunity(sql, seller.account.id, opportunity.id);
		expect(original?.stageId).toBe(opportunity.stageId);
	});

	it('rejects moving a deal onto another account stage', async () => {
		const sql = getSql();
		const seller = await createWorkspace('move-seller');
		const stranger = await createWorkspace('move-stranger');
		const opportunity = await createOpportunity(sql, authContext(seller), {
			name: 'Hidden deal',
			contactId: null,
			companyId: null,
			amountCents: null,
			stageId: null
		});
		const strangerStage = (await listPipelines(sql, stranger.account.id))[0]?.stages[1];
		expect(strangerStage).toBeTruthy();

		await expect(
			moveOpportunityStage(sql, authContext(seller), opportunity.id, strangerStage!.id)
		).rejects.toMatchObject({ code: 'validation' });
	});

	it('scopes companies by account_id', async () => {
		const sql = getSql();
		const a = await createWorkspace('co-a');
		const b = await createWorkspace('co-b');
		const contact = await createContact(sql, authContext(a), {
			firstName: 'Jo',
			lastName: 'Host',
			email: null,
			phone: null
		});
		const company = await createCompany(sql, authContext(a), {
			name: 'Host Co',
			domain: null,
			contactId: contact.id
		});

		expect(await getCompany(sql, a.account.id, company.id)).not.toBeNull();
		expect(await getCompany(sql, b.account.id, company.id)).toBeNull();
	});
});
