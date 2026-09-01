import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import {
	generateCustomerSummary,
	generateReplySuggestions,
	processAiFollowUpDraft,
	scheduleOpportunityFollowUp,
	useAiArtifact
} from '$lib/server/domain/ai';
import { createOpportunity } from '$lib/server/domain/opportunities';
import {
	getConversationThread,
	sendConversationSms,
	submitMessagingRegistration
} from '$lib/server/domain/messaging';
import { AppError } from '$lib/server/errors';
import { uuidv7 } from '$lib/server/ids';
import { drainOutbox } from '$lib/server/outbox';
import { FakeAiProvider } from '$lib/server/providers/fake-ai';
import { FakeOutboundWebhookProvider } from '$lib/server/providers/fake-outbound-webhook';
import { FakeBillingProvider } from '$lib/server/providers/fake-billing';
import { FakeMessagingProvider, FakeVoiceProvider } from '$lib/server/providers/fake';
import { getAiArtifact, getLatestAiArtifact, updateAiSettings } from '$lib/server/repos/ai';
import { listActivitiesForContact } from '$lib/server/repos/activities';
import { updateContactConsent } from '$lib/server/repos/contacts';
import { insertMessage } from '$lib/server/repos/messages';
import { getOpportunity } from '$lib/server/repos/opportunities';
import { updateLocationQuietHours } from '$lib/server/repos/locations';
import { outboxHandlers } from '$lib/server/worker';
import {
	activateTestBilling,
	authContext,
	createTestConversation,
	createWorkspace
} from '../helpers';

describe('AI reply and summary drafts', () => {
	it('generates three reply choices and audits both generation and human selection', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('ai-replies');
		const ctx = authContext(workspace);
		const { contact, conversation } = await createTestConversation(workspace);
		const beforeMessages = await sql<{ count: string }[]>`
			select count(*)::text as count from messages where account_id = ${ctx.accountId}
		`;

		const artifact = await generateReplySuggestions(
			sql,
			new FakeAiProvider(),
			ctx,
			conversation.id
		);
		expect(artifact.kind).toBe('reply');
		expect(artifact.content).toMatchObject({ urgency: 'high' });
		expect('choices' in artifact.content && artifact.content.choices).toHaveLength(3);

		const selected = await useAiArtifact(sql, ctx, artifact.id, 0);
		expect(selected.body).toContain('thanks for reaching out');
		expect(selected.artifact.status).toBe('used');
		const afterMessages = await sql<{ count: string }[]>`
			select count(*)::text as count from messages where account_id = ${ctx.accountId}
		`;
		expect(afterMessages[0].count).toBe(beforeMessages[0].count);

		const activities = await listActivitiesForContact(sql, ctx.accountId, contact.id);
		expect(activities.map((activity) => activity.type)).toEqual(
			expect.arrayContaining(['ai.reply_generated', 'ai.draft_selected'])
		);
	});

	it('creates a customer brief with intent, urgency, facts, and next action', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('ai-summary');
		const ctx = authContext(workspace);
		const { contact } = await createTestConversation(workspace, {
			customerMessage: 'Can I get an estimate for a new air conditioner?'
		});

		const artifact = await generateCustomerSummary(sql, new FakeAiProvider(), ctx, contact.id);
		expect(artifact.kind).toBe('summary');
		expect(artifact.content).toMatchObject({
			intent: 'Requesting an estimate',
			urgency: 'medium'
		});
		expect('facts' in artifact.content && artifact.content.facts.length).toBeGreaterThan(0);
		const activities = await listActivitiesForContact(sql, ctx.accountId, contact.id);
		expect(activities.some((activity) => activity.type === 'ai.summary_generated')).toBe(true);
	});

	it('blocks new reply drafts when AI is disabled or the customer opted out', async () => {
		const sql = getSql();
		const disabled = await createWorkspace('ai-disabled');
		const disabledCtx = authContext(disabled);
		const disabledThread = await createTestConversation(disabled);
		await updateAiSettings(sql, disabledCtx.accountId, {
			enabled: false,
			followUpEnabled: true,
			followUpAfterDays: 2
		});
		await expect(
			generateReplySuggestions(sql, new FakeAiProvider(), disabledCtx, disabledThread.conversation.id)
		).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<AppError>);

		const optedOut = await createWorkspace('ai-optout');
		const optedOutCtx = authContext(optedOut);
		const optedOutThread = await createTestConversation(optedOut);
		await updateContactConsent(sql, optedOutCtx.accountId, optedOutThread.contact.id, 'opted_out');
		await expect(
			generateReplySuggestions(sql, new FakeAiProvider(), optedOutCtx, optedOutThread.conversation.id)
		).rejects.toMatchObject({ code: 'validation' } satisfies Partial<AppError>);
	});

	it('rejects a reply artifact after a newer customer message arrives', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('ai-stale');
		const ctx = authContext(workspace);
		const setup = await createTestConversation(workspace);
		const artifact = await generateReplySuggestions(
			sql,
			new FakeAiProvider(),
			ctx,
			setup.conversation.id
		);
		await insertMessage(sql, {
			id: uuidv7(),
			accountId: ctx.accountId,
			locationId: ctx.locationId,
			conversationId: setup.conversation.id,
			contactId: setup.contact.id,
			phoneNumberId: setup.conversation.phoneNumberId,
			direction: 'inbound',
			body: 'Actually, the leak is getting worse.',
			status: 'received',
			providerMessageId: `stale-${uuidv7()}`,
			notBefore: null,
			createdBy: null
		});

		await expect(useAiArtifact(sql, ctx, artifact.id, 1)).rejects.toMatchObject({
			code: 'conflict'
		} satisfies Partial<AppError>);
		expect((await getAiArtifact(sql, ctx.accountId, artifact.id))?.status).toBe('stale');
	});

	it('keeps quiet-hour deferral on a human-sent AI draft', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('ai-quiet');
		const ctx = authContext(workspace);
		const setup = await createTestConversation(workspace);
		await activateTestBilling(workspace);
		await submitMessagingRegistration(sql, new FakeMessagingProvider(), ctx, {
			legalName: 'AI Quiet LLC',
			ein: null,
			website: null,
			address: '1 Main St, Austin TX',
			contactEmail: 'owner@ai-quiet.test',
			useCase: 'Customer service',
			sampleMessage: 'Thanks for reaching out. Reply STOP to opt out.'
		});
		await updateLocationQuietHours(sql, ctx.accountId, ctx.locationId, {
			timezone: 'UTC',
			quietStart: '00:00',
			quietEnd: '23:59'
		});
		const artifact = await generateReplySuggestions(
			sql,
			new FakeAiProvider(),
			ctx,
			setup.conversation.id
		);
		const selected = await useAiArtifact(sql, ctx, artifact.id, 0);
		const message = await sendConversationSms(
			sql,
			ctx,
			setup.conversation.id,
			selected.body
		);
		expect(message.notBefore).not.toBeNull();

		const messaging = new FakeMessagingProvider();
		await drainOutbox(
			sql,
			{
				messaging,
				voice: new FakeVoiceProvider(),
				billing: new FakeBillingProvider(),
				ai: new FakeAiProvider(),
				webhook: new FakeOutboundWebhookProvider()
			},
			outboxHandlers
		);
		expect(messaging.sent).toEqual([]);
		const thread = await getConversationThread(sql, ctx, setup.conversation.id);
		expect(thread.messages.at(-1)?.status).toBe('queued');
	});
});

describe('AI idle-lead worker', () => {
	it('queues a follow-up for owner review without creating or sending a message', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('ai-followup');
		const ctx = authContext(workspace);
		const setup = await createTestConversation(workspace);
		const opportunity = await createOpportunity(sql, ctx, {
			name: 'Emergency water heater service',
			contactId: setup.contact.id,
			companyId: null,
			amountCents: null,
			stageId: null
		});
		await sql`
			update opportunities
			set updated_at = now() - interval '3 days'
			where account_id = ${ctx.accountId} and id = ${opportunity.id}
		`;
		await sql`
			update conversations
			set last_message_at = now() - interval '3 days', updated_at = now() - interval '3 days'
			where account_id = ${ctx.accountId} and id = ${setup.conversation.id}
		`;
		await sql`
			update messages
			set created_at = now() - interval '3 days', updated_at = now() - interval '3 days'
			where account_id = ${ctx.accountId} and conversation_id = ${setup.conversation.id}
		`;
		const idle = await getOpportunity(sql, ctx.accountId, opportunity.id);
		expect(idle).not.toBeNull();
		await sql`delete from outbox where account_id = ${ctx.accountId}`;
		await scheduleOpportunityFollowUp(sql, { accountId: ctx.accountId, opportunity: idle! });

		const messaging = new FakeMessagingProvider();
		const beforeMessages = await sql<{ count: string }[]>`
			select count(*)::text as count from messages where account_id = ${ctx.accountId}
		`;
		await drainOutbox(
			sql,
			{
				messaging,
				voice: new FakeVoiceProvider(),
				billing: new FakeBillingProvider(),
				ai: new FakeAiProvider(),
				webhook: new FakeOutboundWebhookProvider()
			},
			outboxHandlers
		);

		const artifact = await getLatestAiArtifact(sql, ctx.accountId, {
			kind: 'follow_up',
			opportunityId: opportunity.id
		});
		expect(artifact).toMatchObject({ kind: 'follow_up', status: 'ready' });
		const afterMessages = await sql<{ count: string }[]>`
			select count(*)::text as count from messages where account_id = ${ctx.accountId}
		`;
		expect(afterMessages[0].count).toBe(beforeMessages[0].count);
		expect(messaging.sent).toEqual([]);
		const activities = await listActivitiesForContact(sql, ctx.accountId, setup.contact.id);
		expect(activities.some((activity) => activity.type === 'ai.follow_up_drafted')).toBe(true);
	});

	it('does nothing when a follow-up job is processed for an opted-out customer', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('ai-followup-stop');
		const ctx = authContext(workspace);
		const setup = await createTestConversation(workspace);
		await updateContactConsent(sql, ctx.accountId, setup.contact.id, 'opted_out');
		const opportunity = await createOpportunity(sql, ctx, {
			name: 'Stopped lead', contactId: setup.contact.id, companyId: null,
			amountCents: null, stageId: null
		});
		await processAiFollowUpDraft(sql, new FakeAiProvider(), {
			accountId: ctx.accountId,
			opportunityId: opportunity.id,
			sourceOpportunityUpdatedAt: opportunity.updatedAt
		});
		expect(
			await getLatestAiArtifact(sql, ctx.accountId, { kind: 'follow_up', opportunityId: opportunity.id })
		).toBeNull();
	});
});
