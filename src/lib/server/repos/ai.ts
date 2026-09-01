import type { AiArtifact, AiArtifactStatus, AiSettings } from '$lib/types';
import type { Queryable } from '../db';

type AiSettingsRow = {
	enabled: boolean;
	follow_up_enabled: boolean;
	follow_up_after_days: number;
};

type AiArtifactRow = {
	id: string;
	location_id: string;
	contact_id: string;
	conversation_id: string | null;
	opportunity_id: string | null;
	kind: AiArtifact['kind'];
	status: AiArtifactStatus;
	content: AiArtifact['content'];
	source_last_message_id: string | null;
	provider: string;
	model: string;
	selected_reply_index: number | null;
	created_at: Date;
	updated_at: Date;
};

const ARTIFACT_COLUMNS = [
	'id',
	'location_id',
	'contact_id',
	'conversation_id',
	'opportunity_id',
	'kind',
	'status',
	'content',
	'source_last_message_id',
	'provider',
	'model',
	'selected_reply_index',
	'created_at',
	'updated_at'
] as const;

function mapSettings(row: AiSettingsRow): AiSettings {
	return {
		enabled: row.enabled,
		followUpEnabled: row.follow_up_enabled,
		followUpAfterDays: row.follow_up_after_days
	};
}

function mapArtifact(row: AiArtifactRow): AiArtifact {
	return {
		id: row.id,
		locationId: row.location_id,
		contactId: row.contact_id,
		conversationId: row.conversation_id,
		opportunityId: row.opportunity_id,
		kind: row.kind,
		status: row.status,
		content: row.content,
		sourceLastMessageId: row.source_last_message_id,
		provider: row.provider,
		model: row.model,
		selectedReplyIndex: row.selected_reply_index,
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString()
	};
}

export async function insertDefaultAiSettings(sql: Queryable, accountId: string): Promise<void> {
	await sql`
		insert into account_ai_settings (account_id)
		values (${accountId})
		on conflict (account_id) do nothing
	`;
}

export async function getAiSettings(sql: Queryable, accountId: string): Promise<AiSettings> {
	await insertDefaultAiSettings(sql, accountId);
	const rows = await sql<AiSettingsRow[]>`
		select enabled, follow_up_enabled, follow_up_after_days
		from account_ai_settings
		where account_id = ${accountId}
		limit 1
	`;
	return mapSettings(rows[0]);
}

export async function updateAiSettings(
	sql: Queryable,
	accountId: string,
	settings: AiSettings
): Promise<AiSettings | null> {
	const rows = await sql<AiSettingsRow[]>`
		update account_ai_settings
		set enabled = ${settings.enabled},
			follow_up_enabled = ${settings.followUpEnabled},
			follow_up_after_days = ${settings.followUpAfterDays},
			updated_at = now()
		where account_id = ${accountId}
		returning enabled, follow_up_enabled, follow_up_after_days
	`;
	return rows[0] ? mapSettings(rows[0]) : null;
}

export async function insertAiArtifact(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		locationId: string;
		contactId: string;
		conversationId: string | null;
		opportunityId: string | null;
		kind: AiArtifact['kind'];
		content: AiArtifact['content'];
		sourceLastMessageId: string | null;
		provider: string;
		model: string;
		createdBy: string | null;
	}
): Promise<AiArtifact> {
	const rows = await sql<AiArtifactRow[]>`
		insert into ai_artifacts (
			id, account_id, location_id, contact_id, conversation_id, opportunity_id,
			kind, content, source_last_message_id, provider, model, created_by
		)
		values (
			${row.id}, ${row.accountId}, ${row.locationId}, ${row.contactId},
			${row.conversationId}, ${row.opportunityId}, ${row.kind},
			${sql.json(row.content as never)}, ${row.sourceLastMessageId},
			${row.provider}, ${row.model}, ${row.createdBy}
		)
		returning ${sql(ARTIFACT_COLUMNS as unknown as string[])}
	`;
	return mapArtifact(rows[0]);
}

export async function getAiArtifact(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<AiArtifact | null> {
	const rows = await sql<AiArtifactRow[]>`
		select ${sql(ARTIFACT_COLUMNS as unknown as string[])}
		from ai_artifacts
		where account_id = ${accountId} and id = ${id}
		limit 1
	`;
	return rows[0] ? mapArtifact(rows[0]) : null;
}

export async function getLatestAiArtifact(
	sql: Queryable,
	accountId: string,
	filter: {
		kind: AiArtifact['kind'];
		conversationId?: string;
		contactId?: string;
		opportunityId?: string;
	}
): Promise<AiArtifact | null> {
	const rows = await sql<AiArtifactRow[]>`
		select ${sql(ARTIFACT_COLUMNS as unknown as string[])}
		from ai_artifacts
		where account_id = ${accountId}
			and kind = ${filter.kind}
			${filter.conversationId ? sql`and conversation_id = ${filter.conversationId}` : sql``}
			${filter.contactId ? sql`and contact_id = ${filter.contactId}` : sql``}
			${filter.opportunityId ? sql`and opportunity_id = ${filter.opportunityId}` : sql``}
		order by created_at desc, id desc
		limit 1
	`;
	return rows[0] ? mapArtifact(rows[0]) : null;
}

export async function listReadyFollowUps(
	sql: Queryable,
	accountId: string
): Promise<AiArtifact[]> {
	const rows = await sql<AiArtifactRow[]>`
		select ${sql(ARTIFACT_COLUMNS as unknown as string[])}
		from ai_artifacts
		where account_id = ${accountId} and kind = 'follow_up' and status = 'ready'
		order by created_at desc, id desc
		limit 100
	`;
	return rows.map(mapArtifact);
}

export async function markPriorArtifactsStale(
	sql: Queryable,
	accountId: string,
	filter: {
		kind: AiArtifact['kind'];
		conversationId?: string;
		contactId?: string;
		opportunityId?: string;
	}
): Promise<void> {
	await sql`
		update ai_artifacts
		set status = 'stale', updated_at = now()
		where account_id = ${accountId}
			and kind = ${filter.kind}
			and status = 'ready'
			${filter.conversationId ? sql`and conversation_id = ${filter.conversationId}` : sql``}
			${filter.contactId ? sql`and contact_id = ${filter.contactId}` : sql``}
			${filter.opportunityId ? sql`and opportunity_id = ${filter.opportunityId}` : sql``}
	`;
}

export async function markAiArtifactStale(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<void> {
	await sql`
		update ai_artifacts
		set status = 'stale', updated_at = now()
		where account_id = ${accountId} and id = ${id} and status = 'ready'
	`;
}

export async function markAiArtifactUsed(
	sql: Queryable,
	accountId: string,
	id: string,
	selectedReplyIndex: number | null
): Promise<AiArtifact | null> {
	const rows = await sql<AiArtifactRow[]>`
		update ai_artifacts
		set status = 'used', selected_reply_index = ${selectedReplyIndex}, updated_at = now()
		where account_id = ${accountId} and id = ${id} and status = 'ready'
		returning ${sql(ARTIFACT_COLUMNS as unknown as string[])}
	`;
	return rows[0] ? mapArtifact(rows[0]) : null;
}
