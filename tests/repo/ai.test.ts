import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import { uuidv7 } from '$lib/server/ids';
import {
	getAiArtifact,
	getAiSettings,
	insertAiArtifact,
	listReadyFollowUps,
	updateAiSettings
} from '$lib/server/repos/ai';
import { authContext, createTestConversation, createWorkspace } from '../helpers';

describe('AI repository tenant isolation', () => {
	it('scopes settings and artifacts by account_id', async () => {
		const sql = getSql();
		const alpha = await createWorkspace('ai-repo-a');
		const beta = await createWorkspace('ai-repo-b');
		const alphaCtx = authContext(alpha);
		const betaCtx = authContext(beta);
		const setup = await createTestConversation(alpha);

		await updateAiSettings(sql, alphaCtx.accountId, {
			enabled: false,
			followUpEnabled: false,
			followUpAfterDays: 7
		});
		expect(await getAiSettings(sql, alphaCtx.accountId)).toMatchObject({ enabled: false, followUpAfterDays: 7 });
		expect(await getAiSettings(sql, betaCtx.accountId)).toMatchObject({ enabled: true, followUpAfterDays: 2 });

		const artifact = await insertAiArtifact(sql, {
			id: uuidv7(),
			accountId: alphaCtx.accountId,
			locationId: alphaCtx.locationId,
			contactId: setup.contact.id,
			conversationId: setup.conversation.id,
			opportunityId: null,
			kind: 'follow_up',
			content: {
				body: 'Checking in — would you like help with the next step?',
				rationale: 'Idle lead',
				urgency: 'medium',
				nextAction: 'Review the draft'
			},
			sourceLastMessageId: setup.message.id,
			provider: 'fake',
			model: 'test',
			createdBy: alpha.user.id
		});

		expect(await getAiArtifact(sql, alphaCtx.accountId, artifact.id)).not.toBeNull();
		expect(await getAiArtifact(sql, betaCtx.accountId, artifact.id)).toBeNull();
		expect(await listReadyFollowUps(sql, betaCtx.accountId)).toEqual([]);
	});
});
