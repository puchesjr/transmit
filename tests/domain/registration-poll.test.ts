import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import { listAccountNumbers, processRegistrationRefresh, provisionNumber, submitMessagingRegistration } from '$lib/server/domain/messaging';
import { drainOutbox, RetryAt } from '$lib/server/outbox';
import { FakeAiProvider } from '$lib/server/providers/fake-ai';
import { FakeBillingProvider } from '$lib/server/providers/fake-billing';
import { FakeOutboundWebhookProvider } from '$lib/server/providers/fake-outbound-webhook';
import { FakeMessagingProvider, FakeVoiceProvider } from '$lib/server/providers/fake';
import { getRegistration } from '$lib/server/repos/registrations';
import { outboxHandlers } from '$lib/server/worker';
import { activateTestBilling, authContext, createWorkspace, registrationInput } from '../helpers';

type OutboxRow = { kind: string; run_after: Date; processed_at: Date | null; payload: { until?: string } };

async function pendingJobs(accountId: string): Promise<OutboxRow[]> {
	return getSql()<OutboxRow[]>`
		select kind, run_after, processed_at, payload from outbox
		where account_id = ${accountId} and kind = 'messaging.registration.refresh'
		order by created_at asc
	`;
}

describe('registration status polling', () => {
	it('schedules an hourly carrier check for a submitted registration and stops once approved', async () => {
		const sql = getSql();
		const provider = new FakeMessagingProvider();
		provider.registrationStatus = 'submitted';
		const workspace = await createWorkspace('poll-submitted');
		const ctx = authContext(workspace);
		await activateTestBilling(workspace);
		await submitMessagingRegistration(sql, provider, ctx, registrationInput());
		const number = await provisionNumber(sql, provider, ctx, '+15125559871');
		expect(number.campaignAssignedAt).toBeNull();

		const [job] = await pendingJobs(ctx.accountId);
		expect(job).toBeTruthy();
		expect(job.processed_at).toBeNull();
		expect(job.run_after.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
		expect(Date.parse(job.payload.until ?? '')).toBeGreaterThan(Date.now() + 29 * 86_400_000);

		// Still under review: reschedule without burning attempts.
		await expect(processRegistrationRefresh(sql, provider, job.payload)).rejects.toBeInstanceOf(RetryAt);
		expect((await getRegistration(sql, ctx.accountId))?.status).toBe('submitted');

		provider.registrationStatus = 'approved';
		await expect(processRegistrationRefresh(sql, provider, job.payload)).resolves.toBeUndefined();
		expect((await getRegistration(sql, ctx.accountId))?.status).toBe('approved');
		await drainOutbox(
			sql,
			{ messaging: provider, voice: new FakeVoiceProvider(), billing: new FakeBillingProvider(), ai: new FakeAiProvider(), webhook: new FakeOutboundWebhookProvider() },
			outboxHandlers
		);
		expect(provider.assigned).toEqual([{ phoneNumber: number.e164, campaignId: expect.stringMatching(/^fake-campaign-/) }]);
		expect((await listAccountNumbers(sql, ctx))[0]?.campaignAssignedAt).toBeTruthy();

		// Approved registrations are never polled again.
		await expect(processRegistrationRefresh(sql, provider, job.payload)).resolves.toBeUndefined();
	});

	it('does not schedule polling when the carrier approves at submission', async () => {
		const sql = getSql();
		const provider = new FakeMessagingProvider();
		const workspace = await createWorkspace('poll-approved');
		await activateTestBilling(workspace);
		await submitMessagingRegistration(sql, provider, authContext(workspace), registrationInput());
		expect(await pendingJobs(workspace.account.id)).toEqual([]);
	});

	it('survives a carrier API failure and gives up only after the poll window', async () => {
		const sql = getSql();
		const provider = new FakeMessagingProvider();
		provider.registrationStatus = 'submitted';
		const workspace = await createWorkspace('poll-flaky');
		const ctx = authContext(workspace);
		await activateTestBilling(workspace);
		await submitMessagingRegistration(sql, provider, ctx, registrationInput());
		provider.getRegistrationStatus = async () => {
			throw new Error('telnyx 503');
		};
		const future = { accountId: ctx.accountId, until: new Date(Date.now() + 3_600_000).toISOString() };
		await expect(processRegistrationRefresh(sql, provider, future)).rejects.toBeInstanceOf(RetryAt);
		const expired = { accountId: ctx.accountId, until: new Date(Date.now() - 1000).toISOString() };
		await expect(processRegistrationRefresh(sql, provider, expired)).resolves.toBeUndefined();
		expect((await getRegistration(sql, ctx.accountId))?.status).toBe('submitted');
	});
});
