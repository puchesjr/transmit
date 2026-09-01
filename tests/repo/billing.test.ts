import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import {
	getBillingAccount,
	getUsageEvent,
	insertUsageEvent,
	listLocationUsage
} from '$lib/server/repos/billing';
import { createWorkspace } from '../helpers';

describe('billing repository tenant isolation', () => {
	it('scopes billing accounts and usage events by account_id', async () => {
		const sql = getSql();
		const alpha = await createWorkspace('billing-repo-a');
		const beta = await createWorkspace('billing-repo-b');
		const event = await insertUsageEvent(sql, {
			accountId: alpha.account.id,
			locationId: alpha.location.id,
			metric: 'message_outbound',
			quantity: 3,
			sourceType: 'message',
			sourceId: 'tenant-a-only',
			occurredAt: new Date()
		});
		expect(event).not.toBeNull();

		expect(await getBillingAccount(sql, alpha.account.id)).not.toBeNull();
		expect(await getUsageEvent(sql, beta.account.id, event!.id)).toBeNull();
		const betaUsage = await listLocationUsage(
			sql,
			beta.account.id,
			new Date(Date.now() - 86_400_000),
			new Date(Date.now() + 86_400_000)
		);
		expect(betaUsage[0]).toMatchObject({ outboundMessages: 0, inboundMessages: 0 });
	});
});
