import type { Sql } from '../db';
import { AppError } from '../errors';
import { enqueue, type OutboxKind } from '../outbox';
import type { MessagingProvider } from '../providers/messaging';
import type { VoiceProvider } from '../providers/voice';

export async function handleTelnyxWebhook(
	sql: Sql,
	messaging: MessagingProvider,
	voice: VoiceProvider,
	rawBody: string,
	signature: string | null,
	timestamp: string | null
): Promise<{ accepted: boolean; duplicate: boolean }> {
	let payload: unknown;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		throw new AppError('validation', 'Invalid webhook body');
	}

	const messagingEvent = messaging.parseWebhook(payload);
	const voiceEvent = voice.parseWebhook(payload);
	const verified = voiceEvent
		? voice.verifyWebhook(rawBody, signature, timestamp)
		: messaging.verifyWebhook(rawBody, signature, timestamp);
	if (!verified) throw new AppError('unauthorized', 'Invalid webhook signature');

	const event = messagingEvent ?? voiceEvent;
	if (!event) return { accepted: true, duplicate: false };
	const kind: OutboxKind = messagingEvent ? 'webhook.event' : 'voice.event';

	return sql.begin(async (tx) => {
		const inserted = await tx<{ id: string }[]>`
			insert into provider_events (id) values (${event.eventId})
			on conflict (id) do nothing
			returning id
		`;
		if (inserted.length === 0) return { accepted: true, duplicate: true };

		await enqueue(tx, { kind, accountId: null, payload: { event } });
		return { accepted: true, duplicate: false };
	});
}
