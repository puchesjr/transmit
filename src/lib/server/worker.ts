import { getSql } from './db';
import { processMessageSend, processWebhookEvent } from './domain/messaging';
import { log, serializeError } from './logger';
import { drainOutbox, type OutboxHandlers } from './outbox';
import { getMessagingProvider } from './providers/messaging';

export const outboxHandlers: OutboxHandlers = {
	'message.send': processMessageSend,
	'webhook.event': processWebhookEvent
};

export async function drainOnce(): Promise<number> {
	const provider = await getMessagingProvider();
	return drainOutbox(getSql(), provider, outboxHandlers);
}

/**
 * In-process drain loop. Fine for a single Node process (dev and the current
 * deployment shape); scripts/worker.ts runs the same drain as a dedicated
 * process when we split web and worker.
 */
export function startWorkerLoop(intervalMs = 1500): void {
	const scope = globalThis as { __transmitWorkerLoop?: boolean };
	if (scope.__transmitWorkerLoop) return;
	scope.__transmitWorkerLoop = true;

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
