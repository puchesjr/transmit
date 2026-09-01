import type { WebhookDelivery, WebhookEndpoint, WebhookEventType } from '$lib/types';
import type { Queryable } from '../db';

type EndpointRow = {
	id: string;
	url: string;
	secret_hint: string;
	events: WebhookEventType[];
	enabled: boolean;
	created_at: Date;
	updated_at: Date;
};

type DeliveryRow = {
	id: string;
	event_id: string;
	location_id: string;
	endpoint_id: string;
	event_type: WebhookEventType;
	status: 'pending' | 'delivered' | 'failed';
	attempts: number;
	response_status: number | null;
	last_error: string | null;
	delivered_at: Date | null;
	created_at: Date;
};

export type WebhookDeliveryContext = WebhookDelivery & {
	accountId: string;
	url: string;
	signingSecret: string;
	payload: Record<string, unknown>;
	endpointEnabled: boolean;
};

function mapEndpoint(row: EndpointRow): WebhookEndpoint {
	return {
		id: row.id,
		url: row.url,
		secretHint: row.secret_hint,
		events: row.events,
		enabled: row.enabled,
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString()
	};
}

function mapDelivery(row: DeliveryRow): WebhookDelivery {
	return {
		id: row.id,
		eventId: row.event_id,
		locationId: row.location_id,
		endpointId: row.endpoint_id,
		eventType: row.event_type,
		status: row.status,
		attempts: row.attempts,
		responseStatus: row.response_status,
		lastError: row.last_error,
		deliveredAt: row.delivered_at?.toISOString() ?? null,
		createdAt: row.created_at.toISOString()
	};
}

export async function insertWebhookEndpoint(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		url: string;
		signingSecret: string;
		secretHint: string;
		events: WebhookEventType[];
		createdBy: string;
	}
): Promise<WebhookEndpoint> {
	const rows = await sql<EndpointRow[]>`
		insert into webhook_endpoints (
			id, account_id, url, signing_secret, secret_hint, events, created_by
		)
		values (
			${row.id}, ${row.accountId}, ${row.url}, ${row.signingSecret}, ${row.secretHint},
			${row.events}, ${row.createdBy}
		)
		returning id, url, secret_hint, events, enabled, created_at, updated_at
	`;
	return mapEndpoint(rows[0]);
}

export async function listWebhookEndpoints(
	sql: Queryable,
	accountId: string
): Promise<WebhookEndpoint[]> {
	const rows = await sql<EndpointRow[]>`
		select id, url, secret_hint, events, enabled, created_at, updated_at
		from webhook_endpoints
		where account_id = ${accountId}
		order by created_at desc, id desc
	`;
	return rows.map(mapEndpoint);
}

export async function getWebhookEndpointByUrl(
	sql: Queryable,
	accountId: string,
	url: string
): Promise<WebhookEndpoint | null> {
	const rows = await sql<EndpointRow[]>`
		select id, url, secret_hint, events, enabled, created_at, updated_at
		from webhook_endpoints
		where account_id = ${accountId} and url = ${url}
		limit 1
	`;
	return rows[0] ? mapEndpoint(rows[0]) : null;
}

export async function reactivateWebhookEndpoint(
	sql: Queryable,
	row: {
		accountId: string;
		id: string;
		signingSecret: string;
		secretHint: string;
		events: WebhookEventType[];
		createdBy: string;
	}
): Promise<WebhookEndpoint | null> {
	const rows = await sql<EndpointRow[]>`
		update webhook_endpoints
		set signing_secret = ${row.signingSecret}, secret_hint = ${row.secretHint},
			events = ${row.events}, enabled = true, created_by = ${row.createdBy}, updated_at = now()
		where account_id = ${row.accountId} and id = ${row.id} and enabled = false
		returning id, url, secret_hint, events, enabled, created_at, updated_at
	`;
	return rows[0] ? mapEndpoint(rows[0]) : null;
}

export async function disableWebhookEndpoint(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<boolean> {
	const rows = await sql<{ id: string }[]>`
		update webhook_endpoints
		set enabled = false, updated_at = now()
		where account_id = ${accountId} and id = ${id}
		returning id
	`;
	return Boolean(rows[0]);
}

export async function listMatchingWebhookEndpoints(
	sql: Queryable,
	accountId: string,
	eventType: WebhookEventType
): Promise<{ id: string }[]> {
	return sql<{ id: string }[]>`
		select id
		from webhook_endpoints
		where account_id = ${accountId} and enabled = true and ${eventType} = any(events)
		order by created_at asc, id asc
	`;
}

export async function insertWebhookDelivery(
	sql: Queryable,
	row: {
		id: string;
		eventId: string;
		accountId: string;
		locationId: string;
		endpointId: string;
		eventType: WebhookEventType;
		payload: Record<string, unknown>;
	}
): Promise<void> {
	await sql`
		insert into webhook_deliveries (
			id, event_id, account_id, location_id, endpoint_id, event_type, payload
		)
		values (
			${row.id}, ${row.eventId}, ${row.accountId}, ${row.locationId}, ${row.endpointId},
			${row.eventType}, ${sql.json(row.payload as never)}
		)
	`;
}

export async function getWebhookDeliveryContext(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<WebhookDeliveryContext | null> {
	const rows = await sql<(
		DeliveryRow & {
			account_id: string;
			url: string;
			signing_secret: string;
			payload: Record<string, unknown>;
			endpoint_enabled: boolean;
		}
	)[]>`
		select wd.id, wd.event_id, wd.account_id, wd.location_id, wd.endpoint_id,
			wd.event_type, wd.payload, wd.status, wd.attempts, wd.response_status,
			wd.last_error, wd.delivered_at, wd.created_at,
			we.url, we.signing_secret, we.enabled as endpoint_enabled
		from webhook_deliveries wd
		join webhook_endpoints we on we.id = wd.endpoint_id and we.account_id = wd.account_id
		where wd.account_id = ${accountId} and wd.id = ${id}
		limit 1
	`;
	const row = rows[0];
	if (!row) return null;
	return {
		...mapDelivery(row),
		accountId: row.account_id,
		url: row.url,
		signingSecret: row.signing_secret,
		payload: row.payload,
		endpointEnabled: row.endpoint_enabled
	};
}

export async function recordWebhookAttempt(
	sql: Queryable,
	accountId: string,
	id: string,
	result: { status: 'pending' | 'delivered' | 'failed'; responseStatus: number | null; error: string | null }
): Promise<void> {
	await sql`
		update webhook_deliveries
		set status = ${result.status}, attempts = attempts + 1,
			response_status = ${result.responseStatus}, last_error = ${result.error},
			delivered_at = case when ${result.status} = 'delivered' then now() else delivered_at end,
			updated_at = now()
		where account_id = ${accountId} and id = ${id}
	`;
}

export async function listWebhookDeliveries(
	sql: Queryable,
	accountId: string
): Promise<WebhookDelivery[]> {
	const rows = await sql<DeliveryRow[]>`
		select id, event_id, location_id, endpoint_id, event_type, status, attempts,
			response_status, last_error, delivered_at, created_at
		from webhook_deliveries
		where account_id = ${accountId}
		order by created_at desc, id desc
		limit 50
	`;
	return rows.map(mapDelivery);
}
