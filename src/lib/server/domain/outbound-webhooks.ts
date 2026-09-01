import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { WebhookDelivery, WebhookEndpoint, WebhookEventType } from '$lib/types';
import type { AuthContext } from '../context';
import type { Queryable, Sql } from '../db';
import { AppError } from '../errors';
import { uuidv7 } from '../ids';
import { enqueue } from '../outbox';
import type { OutboundWebhookProvider } from '../providers/outbound-webhook';
import { isPrivateNetworkAddress } from '../providers/outbound-webhook';
import {
	disableWebhookEndpoint,
	getWebhookEndpointByUrl,
	getWebhookDeliveryContext,
	insertWebhookDelivery,
	insertWebhookEndpoint,
	listMatchingWebhookEndpoints,
	listWebhookDeliveries,
	listWebhookEndpoints,
	reactivateWebhookEndpoint,
	recordWebhookAttempt
} from '../repos/webhooks';
import { asObject, requiredString } from '../validation';

const WEBHOOK_EVENTS = new Set<WebhookEventType>([
	'contact.created',
	'message.received',
	'opportunity.stage_changed'
]);
const MAX_WEBHOOK_ATTEMPTS = 8;

export type CreateWebhookEndpointInput = {
	url: string;
	events: WebhookEventType[];
};

export function parseCreateWebhookEndpoint(body: unknown): CreateWebhookEndpointInput {
	const obj = asObject(body);
	const rawUrl = requiredString(obj.url, 'url', 1000);
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new AppError('validation', 'url must be a valid HTTPS URL');
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
		throw new AppError('validation', 'url must be a public HTTPS URL without credentials or a fragment');
	}
	if (isPrivateHostname(url.hostname)) {
		throw new AppError('validation', 'url must not target a private network');
	}

	if (!Array.isArray(obj.events) || obj.events.length === 0) {
		throw new AppError('validation', 'Select at least one webhook event');
	}
	const events = [...new Set(obj.events.map((event) => String(event)))] as WebhookEventType[];
	if (events.some((event) => !WEBHOOK_EVENTS.has(event))) {
		throw new AppError('validation', 'events contains an unsupported event');
	}
	return { url: url.toString(), events };
}

function isPrivateHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (
		normalized === 'localhost' ||
		normalized.endsWith('.localhost') ||
		normalized.endsWith('.local') ||
		normalized === '::1'
	) {
		return true;
	}
	return isPrivateNetworkAddress(normalized);
}

function requireOwner(ctx: AuthContext): void {
	if (ctx.role !== 'owner') throw new AppError('forbidden', 'Owner access required');
}

export async function createWebhookEndpoint(
	sql: Sql,
	ctx: AuthContext,
	input: CreateWebhookEndpointInput
): Promise<{ endpoint: WebhookEndpoint; signingSecret: string }> {
	requireOwner(ctx);
	const signingSecret = `whsec_${randomBytes(32).toString('base64url')}`;
	const existing = await getWebhookEndpointByUrl(sql, ctx.accountId, input.url);
	if (existing?.enabled) throw new AppError('conflict', 'That webhook URL already exists');
	if (existing) {
		const endpoint = await reactivateWebhookEndpoint(sql, {
			accountId: ctx.accountId,
			id: existing.id,
			signingSecret,
			secretHint: signingSecret.slice(-6),
			events: input.events,
			createdBy: ctx.userId
		});
		if (!endpoint) throw new AppError('not_found', 'Webhook endpoint not found');
		return { endpoint, signingSecret };
	}
	try {
		const endpoint = await insertWebhookEndpoint(sql, {
			id: uuidv7(),
			accountId: ctx.accountId,
			url: input.url,
			signingSecret,
			secretHint: signingSecret.slice(-6),
			events: input.events,
			createdBy: ctx.userId
		});
		return { endpoint, signingSecret };
	} catch (error) {
		const pg = error as { code?: string; constraint_name?: string };
		if (pg.code === '23505' && pg.constraint_name === 'webhook_endpoints_account_id_url_key') {
			throw new AppError('conflict', 'That webhook URL already exists');
		}
		throw error;
	}
}

export async function getWebhookSettings(
	sql: Sql,
	ctx: AuthContext
): Promise<{ endpoints: WebhookEndpoint[]; deliveries: WebhookDelivery[] }> {
	const [endpoints, deliveries] = await Promise.all([
		listWebhookEndpoints(sql, ctx.accountId),
		listWebhookDeliveries(sql, ctx.accountId)
	]);
	return { endpoints, deliveries };
}

export async function removeWebhookEndpoint(
	sql: Sql,
	ctx: AuthContext,
	id: string
): Promise<void> {
	requireOwner(ctx);
	if (!(await disableWebhookEndpoint(sql, ctx.accountId, id))) {
		throw new AppError('not_found', 'Webhook endpoint not found');
	}
}

export async function queueOutboundWebhookEvent(
	sql: Queryable,
	input: {
		accountId: string;
		locationId: string;
		eventType: WebhookEventType;
		data: Record<string, unknown>;
	}
): Promise<number> {
	const endpoints = await listMatchingWebhookEndpoints(sql, input.accountId, input.eventType);
	if (endpoints.length === 0) return 0;

	const eventId = uuidv7();
	const envelope = {
		id: eventId,
		type: input.eventType,
		createdAt: new Date().toISOString(),
		accountId: input.accountId,
		locationId: input.locationId,
		data: input.data
	};
	for (const endpoint of endpoints) {
		const deliveryId = uuidv7();
		await insertWebhookDelivery(sql, {
			id: deliveryId,
			eventId,
			accountId: input.accountId,
			locationId: input.locationId,
			endpointId: endpoint.id,
			eventType: input.eventType,
			payload: envelope
		});
		await enqueue(sql, {
			kind: 'outbound_webhook.deliver',
			accountId: input.accountId,
			payload: { accountId: input.accountId, deliveryId }
		});
	}
	return endpoints.length;
}

export function signWebhookPayload(body: string, timestamp: string, secret: string): string {
	return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export function verifyWebhookSignature(
	body: string,
	timestamp: string,
	secret: string,
	signature: string
): boolean {
	const expected = signWebhookPayload(body, timestamp, secret);
	const expectedBuffer = Buffer.from(expected);
	const actualBuffer = Buffer.from(signature);
	return (
		expectedBuffer.length === actualBuffer.length &&
		timingSafeEqual(expectedBuffer, actualBuffer)
	);
}

export async function processOutboundWebhookDelivery(
	sql: Sql,
	provider: OutboundWebhookProvider,
	payload: Record<string, unknown>
): Promise<void> {
	const accountId = String(payload.accountId ?? '');
	const deliveryId = String(payload.deliveryId ?? '');
	const delivery = await getWebhookDeliveryContext(sql, accountId, deliveryId);
	if (!delivery || delivery.status !== 'pending') return;
	if (!delivery.endpointEnabled) {
		await recordWebhookAttempt(sql, accountId, deliveryId, {
			status: 'failed',
			responseStatus: null,
			error: 'endpoint disabled'
		});
		return;
	}

	const body = JSON.stringify(delivery.payload);
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = signWebhookPayload(body, timestamp, delivery.signingSecret);
	try {
		const response = await provider.deliver({
			url: delivery.url,
			body,
			headers: {
				'content-type': 'application/json',
				'user-agent': 'Transmit-Webhooks/1.0',
				'x-transmit-event': delivery.eventType,
				'x-transmit-id': delivery.eventId,
				'x-transmit-timestamp': timestamp,
				'x-transmit-signature': signature
			}
		});
		if (response.status >= 200 && response.status < 300) {
			await recordWebhookAttempt(sql, accountId, deliveryId, {
				status: 'delivered',
				responseStatus: response.status,
				error: null
			});
			return;
		}
		const final = delivery.attempts + 1 >= MAX_WEBHOOK_ATTEMPTS;
		await recordWebhookAttempt(sql, accountId, deliveryId, {
			status: final ? 'failed' : 'pending',
			responseStatus: response.status,
			error: `HTTP ${response.status}`
		});
		throw new Error(`webhook delivery returned HTTP ${response.status}`);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith('webhook delivery returned')) {
			throw error;
		}
		const final = delivery.attempts + 1 >= MAX_WEBHOOK_ATTEMPTS;
		const message = error instanceof Error ? error.message : 'webhook delivery failed';
		await recordWebhookAttempt(sql, accountId, deliveryId, {
			status: final ? 'failed' : 'pending',
			responseStatus: null,
			error: message.slice(0, 500)
		});
		throw error;
	}
}
