import { contactName } from '$lib/format';
import type {
	AiArtifact,
	AiFollowUpContent,
	AiReplyContent,
	AiSettings,
	AiSummaryContent,
	Contact,
	Message,
	Opportunity
} from '$lib/types';
import type { AuthContext } from '../context';
import type { Queryable, Sql } from '../db';
import { AppError } from '../errors';
import { uuidv7 } from '../ids';
import { enqueue, RetryAt } from '../outbox';
import type { AiConversationContext, AiFollowUpContext, AiProvider } from '../providers/ai';
import { insertActivity } from '../repos/activities';
import {
	getAiArtifact,
	getAiSettings,
	getLatestAiArtifact,
	insertAiArtifact,
	listReadyFollowUps,
	markAiArtifactStale,
	markAiArtifactUsed,
	markPriorArtifactsStale,
	updateAiSettings
} from '../repos/ai';
import { getContact } from '../repos/contacts';
import { getConversation, getLatestConversationForContact } from '../repos/conversations';
import { getLocation } from '../repos/locations';
import {
	getLatestMessageForContact,
	getLatestMessageForConversation,
	listMessagesForContact,
	listMessagesForConversation
} from '../repos/messages';
import { getOpportunity } from '../repos/opportunities';
import { asObject } from '../validation';

const MAX_CONTEXT_MESSAGES = 30;
const MAX_CONTEXT_BODY = 2_000;
const CLOSED_STAGES = new Set(['closed won', 'closed lost']);

function isClosedOpportunity(opportunity: Opportunity): boolean {
	return CLOSED_STAGES.has(opportunity.stageName.trim().toLowerCase());
}

function assertEnabled(settings: AiSettings): void {
	if (!settings.enabled) throw new AppError('forbidden', 'AI is disabled for this workspace');
}

function assertCanDraftForContact(contact: Contact): void {
	if (!contact.phone) throw new AppError('validation', 'Customer has no phone number');
	if (contact.messagingConsent === 'opted_out') {
		throw new AppError('validation', 'Customer has opted out of SMS');
	}
}

function conversationContext(
	contact: Contact,
	locationName: string,
	messages: Message[]
): AiConversationContext {
	return {
		customerFirstName: contact.firstName.trim(),
		locationName,
		messages: messages.slice(-MAX_CONTEXT_MESSAGES).map((message) => ({
			direction: message.direction === 'inbound' ? 'customer' : 'business',
			body: message.body.slice(0, MAX_CONTEXT_BODY),
			sentAt: message.createdAt
		}))
	};
}

async function loadConversationContext(
	sql: Queryable,
	accountId: string,
	conversationId: string
): Promise<{
	contact: Contact;
	locationId: string;
	messages: Message[];
	latestMessage: Message;
	context: AiConversationContext;
}> {
	const conversation = await getConversation(sql, accountId, conversationId);
	if (!conversation) throw new AppError('not_found', 'Conversation not found');
	const [contact, messages, location] = await Promise.all([
		getContact(sql, accountId, conversation.contactId),
		listMessagesForConversation(sql, accountId, conversationId),
		getLocation(sql, accountId, conversation.locationId)
	]);
	if (!contact || !location) throw new AppError('not_found', 'Conversation context not found');
	const latestMessage = messages.at(-1);
	if (!latestMessage) throw new AppError('validation', 'Conversation has no messages to analyze');
	return {
		contact,
		locationId: conversation.locationId,
		messages,
		latestMessage,
		context: conversationContext(contact, location.name, messages)
	};
}

async function loadContactContext(
	sql: Queryable,
	accountId: string,
	contactId: string
): Promise<{
	contact: Contact;
	messages: Message[];
	latestMessage: Message;
	context: AiConversationContext;
}> {
	const contact = await getContact(sql, accountId, contactId);
	if (!contact) throw new AppError('not_found', 'Customer not found');
	const [messages, location] = await Promise.all([
		listMessagesForContact(sql, accountId, contactId),
		getLocation(sql, accountId, contact.locationId)
	]);
	if (!location) throw new AppError('not_found', 'Customer location not found');
	const latestMessage = messages.at(-1);
	if (!latestMessage) throw new AppError('validation', 'Customer has no messages to analyze');
	return {
		contact,
		messages,
		latestMessage,
		context: conversationContext(contact, location.name, messages)
	};
}

export function parseAiSettings(body: unknown): AiSettings {
	const obj = asObject(body);
	if (typeof obj.enabled !== 'boolean' || typeof obj.followUpEnabled !== 'boolean') {
		throw new AppError('validation', 'AI settings are invalid');
	}
	if (
		typeof obj.followUpAfterDays !== 'number' ||
		!Number.isInteger(obj.followUpAfterDays) ||
		obj.followUpAfterDays < 1 ||
		obj.followUpAfterDays > 30
	) {
		throw new AppError('validation', 'followUpAfterDays must be between 1 and 30');
	}
	return {
		enabled: obj.enabled,
		followUpEnabled: obj.followUpEnabled,
		followUpAfterDays: obj.followUpAfterDays
	};
}

export function parseArtifactUse(body: unknown): { choiceIndex: number | null } {
	const obj = asObject(body);
	if (obj.choiceIndex == null) return { choiceIndex: null };
	if (
		typeof obj.choiceIndex !== 'number' ||
		!Number.isInteger(obj.choiceIndex) ||
		obj.choiceIndex < 0 ||
		obj.choiceIndex > 2
	) {
		throw new AppError('validation', 'choiceIndex is invalid');
	}
	return { choiceIndex: obj.choiceIndex };
}

export async function getAccountAiSettings(sql: Sql, ctx: AuthContext): Promise<AiSettings> {
	return getAiSettings(sql, ctx.accountId);
}

export async function saveAccountAiSettings(
	sql: Sql,
	ctx: AuthContext,
	settings: AiSettings
): Promise<AiSettings> {
	if (ctx.role !== 'owner') throw new AppError('forbidden', 'Only an owner can change AI settings');
	await getAiSettings(sql, ctx.accountId);
	const updated = await updateAiSettings(sql, ctx.accountId, settings);
	if (!updated) throw new AppError('not_found', 'AI settings not found');
	return updated;
}

export async function getLatestReplySuggestions(
	sql: Sql,
	ctx: AuthContext,
	conversationId: string
): Promise<AiArtifact | null> {
	const conversation = await getConversation(sql, ctx.accountId, conversationId);
	if (!conversation) throw new AppError('not_found', 'Conversation not found');
	return getLatestAiArtifact(sql, ctx.accountId, { kind: 'reply', conversationId });
}

export async function generateReplySuggestions(
	sql: Sql,
	provider: AiProvider,
	ctx: AuthContext,
	conversationId: string
): Promise<AiArtifact> {
	assertEnabled(await getAiSettings(sql, ctx.accountId));
	const loaded = await loadConversationContext(sql, ctx.accountId, conversationId);
	assertCanDraftForContact(loaded.contact);
	const content = await provider.suggestReplies(loaded.context);

	return sql.begin(async (tx) => {
		assertEnabled(await getAiSettings(tx, ctx.accountId));
		const [latest, contact] = await Promise.all([
			getLatestMessageForConversation(tx, ctx.accountId, conversationId),
			getContact(tx, ctx.accountId, loaded.contact.id)
		]);
		if (latest?.id !== loaded.latestMessage.id) {
			throw new AppError('conflict', 'The conversation changed. Generate fresh suggestions.');
		}
		if (!contact) throw new AppError('not_found', 'Customer not found');
		assertCanDraftForContact(contact);
		await markPriorArtifactsStale(tx, ctx.accountId, { kind: 'reply', conversationId });
		const artifact = await insertAiArtifact(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			locationId: loaded.locationId,
			contactId: loaded.contact.id,
			conversationId,
			opportunityId: null,
			kind: 'reply',
			content,
			sourceLastMessageId: loaded.latestMessage.id,
			provider: provider.name,
			model: provider.model,
			createdBy: ctx.userId
		});
		await insertActivity(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			contactId: loaded.contact.id,
			companyId: null,
			opportunityId: null,
			type: 'ai.reply_generated',
			summary: `AI drafted reply choices for ${contactName(loaded.contact)}`,
			payload: {
				artifactId: artifact.id,
				conversationId,
				urgency: content.urgency,
				intent: content.intent
			},
			createdBy: ctx.userId
		});
		return artifact;
	});
}

export async function getLatestCustomerSummary(
	sql: Sql,
	ctx: AuthContext,
	contactId: string
): Promise<AiArtifact | null> {
	const contact = await getContact(sql, ctx.accountId, contactId);
	if (!contact) throw new AppError('not_found', 'Customer not found');
	return getLatestAiArtifact(sql, ctx.accountId, { kind: 'summary', contactId });
}

export async function generateCustomerSummary(
	sql: Sql,
	provider: AiProvider,
	ctx: AuthContext,
	contactId: string
): Promise<AiArtifact> {
	assertEnabled(await getAiSettings(sql, ctx.accountId));
	const loaded = await loadContactContext(sql, ctx.accountId, contactId);
	const content = await provider.summarizeConversation(loaded.context);

	return sql.begin(async (tx) => {
		assertEnabled(await getAiSettings(tx, ctx.accountId));
		const latest = await getLatestMessageForContact(tx, ctx.accountId, contactId);
		if (latest?.id !== loaded.latestMessage.id) {
			throw new AppError('conflict', 'The conversation changed. Generate a fresh summary.');
		}
		await markPriorArtifactsStale(tx, ctx.accountId, { kind: 'summary', contactId });
		const artifact = await insertAiArtifact(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			locationId: loaded.contact.locationId,
			contactId,
			conversationId: loaded.latestMessage.conversationId,
			opportunityId: null,
			kind: 'summary',
			content,
			sourceLastMessageId: loaded.latestMessage.id,
			provider: provider.name,
			model: provider.model,
			createdBy: ctx.userId
		});
		await insertActivity(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			contactId,
			companyId: null,
			opportunityId: null,
			type: 'ai.summary_generated',
			summary: `AI summarized the conversation with ${contactName(loaded.contact)}`,
			payload: {
				artifactId: artifact.id,
				urgency: content.urgency,
				intent: content.intent
			},
			createdBy: ctx.userId
		});
		return artifact;
	});
}

function artifactDraftBody(artifact: AiArtifact, choiceIndex: number | null): string {
	if (artifact.kind === 'reply') {
		if (choiceIndex == null) throw new AppError('validation', 'Choose a reply first');
		return (artifact.content as AiReplyContent).choices[choiceIndex].body;
	}
	if (artifact.kind === 'follow_up') {
		if (choiceIndex != null) throw new AppError('validation', 'choiceIndex is not used for follow-ups');
		return (artifact.content as AiFollowUpContent).body;
	}
	throw new AppError('validation', 'Summaries cannot be used as message drafts');
}

export async function useAiArtifact(
	sql: Sql,
	ctx: AuthContext,
	id: string,
	choiceIndex: number | null
): Promise<{ artifact: AiArtifact; body: string }> {
	assertEnabled(await getAiSettings(sql, ctx.accountId));
	const artifact = await getAiArtifact(sql, ctx.accountId, id);
	if (!artifact) throw new AppError('not_found', 'AI draft not found');
	if (artifact.status !== 'ready') throw new AppError('conflict', 'This AI draft is no longer available');
	const contact = await getContact(sql, ctx.accountId, artifact.contactId);
	if (!contact) throw new AppError('not_found', 'Customer not found');
	assertCanDraftForContact(contact);
	const body = artifactDraftBody(artifact, choiceIndex);
	const latest = artifact.conversationId
		? await getLatestMessageForConversation(sql, ctx.accountId, artifact.conversationId)
		: await getLatestMessageForContact(sql, ctx.accountId, artifact.contactId);
	if (latest?.id !== artifact.sourceLastMessageId) {
		await markAiArtifactStale(sql, ctx.accountId, artifact.id);
		throw new AppError('conflict', 'This draft is stale. Generate a fresh one.');
	}

	return sql.begin(async (tx) => {
		const updated = await markAiArtifactUsed(tx, ctx.accountId, artifact.id, choiceIndex);
		if (!updated) throw new AppError('conflict', 'This AI draft is no longer available');
		await insertActivity(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			contactId: artifact.contactId,
			companyId: null,
			opportunityId: artifact.opportunityId,
			type: 'ai.draft_selected',
			summary: `AI ${artifact.kind === 'reply' ? 'reply' : 'follow-up'} selected for human review`,
			payload: { artifactId: artifact.id, choiceIndex },
			createdBy: ctx.userId
		});
		return { artifact: updated, body };
	});
}

export async function listAccountFollowUpDrafts(
	sql: Sql,
	ctx: AuthContext
): Promise<AiArtifact[]> {
	return listReadyFollowUps(sql, ctx.accountId);
}

export async function scheduleOpportunityFollowUp(
	sql: Queryable,
	input: { accountId: string; opportunity: Opportunity }
): Promise<void> {
	const settings = await getAiSettings(sql, input.accountId);
	if (
		!settings.enabled ||
		!settings.followUpEnabled ||
		!input.opportunity.contactId ||
		isClosedOpportunity(input.opportunity)
	) {
		return;
	}
	const updatedAt = new Date(input.opportunity.updatedAt);
	const runAfter = new Date(updatedAt.getTime() + settings.followUpAfterDays * 86_400_000);
	await enqueue(sql, {
		kind: 'ai.follow_up.draft',
		accountId: input.accountId,
		payload: {
			accountId: input.accountId,
			opportunityId: input.opportunity.id,
			sourceOpportunityUpdatedAt: input.opportunity.updatedAt
		},
		runAfter
	});
}

export async function processAiFollowUpDraft(
	sql: Sql,
	provider: AiProvider,
	payload: Record<string, unknown>
): Promise<void> {
	const accountId = String(payload.accountId ?? '');
	const opportunityId = String(payload.opportunityId ?? '');
	const sourceOpportunityUpdatedAt = String(payload.sourceOpportunityUpdatedAt ?? '');
	if (!accountId || !opportunityId || !sourceOpportunityUpdatedAt) return;

	const settings = await getAiSettings(sql, accountId);
	if (!settings.enabled || !settings.followUpEnabled) return;
	const opportunity = await getOpportunity(sql, accountId, opportunityId);
	if (
		!opportunity ||
		!opportunity.contactId ||
		isClosedOpportunity(opportunity) ||
		opportunity.updatedAt !== sourceOpportunityUpdatedAt
	) {
		return;
	}

	const contact = await getContact(sql, accountId, opportunity.contactId);
	if (!contact?.phone || contact.messagingConsent === 'opted_out') return;
	const conversation = await getLatestConversationForContact(sql, accountId, contact.id);
	if (!conversation) return;
	const latestActivityAt = Math.max(
		new Date(opportunity.updatedAt).getTime(),
		new Date(conversation.lastMessageAt).getTime()
	);
	const eligibleAt = new Date(latestActivityAt + settings.followUpAfterDays * 86_400_000);
	if (eligibleAt.getTime() > Date.now()) throw new RetryAt(eligibleAt);
	const loaded = await loadConversationContext(sql, accountId, conversation.id);
	const existing = await getLatestAiArtifact(sql, accountId, {
		kind: 'follow_up',
		opportunityId
	});
	if (existing?.status === 'ready' && existing.sourceLastMessageId === loaded.latestMessage.id) {
		return;
	}

	const context: AiFollowUpContext = {
		...loaded.context,
		opportunityName: opportunity.name,
		stageName: opportunity.stageName,
		idleDays: settings.followUpAfterDays
	};
	const content = await provider.draftFollowUp(context);

	await sql.begin(async (tx) => {
		const [currentSettings, currentOpportunity, latest, currentContact] = await Promise.all([
			getAiSettings(tx, accountId),
			getOpportunity(tx, accountId, opportunityId),
			getLatestMessageForConversation(tx, accountId, conversation.id),
			getContact(tx, accountId, contact.id)
		]);
		if (
			!currentSettings.enabled ||
			!currentSettings.followUpEnabled ||
			!currentOpportunity ||
			currentOpportunity.updatedAt !== sourceOpportunityUpdatedAt ||
			!currentContact?.phone ||
			currentContact.messagingConsent === 'opted_out'
		) {
			return;
		}
		if (latest?.id !== loaded.latestMessage.id) {
			const retryAt = latest
				? new Date(new Date(latest.createdAt).getTime() + currentSettings.followUpAfterDays * 86_400_000)
				: new Date(Date.now() + currentSettings.followUpAfterDays * 86_400_000);
			throw new RetryAt(retryAt);
		}
		await markPriorArtifactsStale(tx, accountId, { kind: 'follow_up', opportunityId });
		const artifact = await insertAiArtifact(tx, {
			id: uuidv7(),
			accountId,
			locationId: opportunity.locationId,
			contactId: contact.id,
			conversationId: conversation.id,
			opportunityId,
			kind: 'follow_up',
			content,
			sourceLastMessageId: loaded.latestMessage.id,
			provider: provider.name,
			model: provider.model,
			createdBy: null
		});
		await insertActivity(tx, {
			id: uuidv7(),
			accountId,
			contactId: contact.id,
			companyId: opportunity.companyId,
			opportunityId,
			type: 'ai.follow_up_drafted',
			summary: `AI drafted a follow-up for ${opportunity.name}; owner approval required`,
			payload: { artifactId: artifact.id, conversationId: conversation.id },
			createdBy: null
		});
	});
}

export function asReplyContent(artifact: AiArtifact): AiReplyContent {
	return artifact.content as AiReplyContent;
}

export function asSummaryContent(artifact: AiArtifact): AiSummaryContent {
	return artifact.content as AiSummaryContent;
}
