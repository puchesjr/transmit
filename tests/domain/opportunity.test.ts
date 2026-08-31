import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import { createOpportunity } from '$lib/server/domain/opportunities';
import { getOpportunity } from '$lib/server/repos/opportunities';
import { authContext, createWorkspace } from '../helpers';

describe('opportunity create', () => {
	it('accepts amounts beyond int4 range up to the validation cap', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('bigdeal');
		const ctx = authContext(workspace);

		const opportunity = await createOpportunity(sql, ctx, {
			name: 'Mega contract',
			contactId: null,
			companyId: null,
			amountCents: 10_000_000_000,
			stageId: null
		});

		expect(opportunity.amountCents).toBe(10_000_000_000);

		const fetched = await getOpportunity(sql, ctx.accountId, opportunity.id);
		expect(fetched?.amountCents).toBe(10_000_000_000);
	});
});
