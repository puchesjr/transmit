import { getSql } from './db';
import { processMessageSend, processWebhookEvent } from './domain/messaging';
import { processVoiceEvent } from './domain/voice';
import { processUsageReport } from './domain/billing';
import { log, serializeError } from './logger';
import { drainOutbox, type OutboxHandlers } from './outbox';
import { getMessagingProvider } from './providers/messaging';
import { getVoiceProvider } from './providers/voice';
import { getBillingProvider } from './providers/billing';
import { getAiProvider } from './providers/ai';
import { processAiFollowUpDraft } from './domain/ai';
import { processOutboundWebhookDelivery } from './domain/outbound-webhooks';
import { getOutboundWebhookProvider } from './providers/outbound-webhook';

export const outboxHandlers: OutboxHandlers = {
	'message.send': (sql, providers, payload) => processMessageSend(sql, providers.messaging, payload),
	'webhook.event': (sql, providers, payload) => processWebhookEvent(sql, providers.messaging, payload),
	'voice.event': (sql, providers, payload) => processVoiceEvent(sql, providers.voice, payload),
	'billing.usage': (sql, providers, payload) => processUsageReport(sql, providers.billing, payload),
	'ai.follow_up.draft': (sql, providers, payload) => processAiFollowUpDraft(sql, providers.ai, payload),
	'outbound_webhook.deliver': (sql, providers, payload) =>
		processOutboundWebhookDelivery(sql, providers.webhook, payload)
};

export async function drainOnce(): Promise<number> {
	const [messaging, voice, billing, ai, webhook] = await Promise.all([
		getMessagingProvider(),
		getVoiceProvider(),
		getBillingProvider(),
		getAiProvider(),
		getOutboundWebhookProvider()
	]);
	return drainOutbox(getSql(), { messaging, voice, billing, ai, webhook }, outboxHandlers);
}

/**
 * In-process drain loop. Fine for a single Node process (dev and the current
 * deployment shape); scripts/worker.ts runs the same drain as a dedicated
 * process when we split web and worker.
 */
export function startWorkerLoop(intervalMs = 1500): void {
	const scope = globalThis as { __kisoWorkerLoop?: boolean };
	if (scope.__kisoWorkerLoop) return;
	scope.__kisoWorkerLoop = true;

	const tick = async () => {
		try {
			await drainOnce();
		} catch (err) {
			log('error', 'worker_tick_failed', { err: serializeError(err) });
		}
		setTimeout(tick, intervalMs);
	};
	setTimeout(tick, intervalMs);
}
