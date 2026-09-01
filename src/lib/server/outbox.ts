import type { Queryable, Sql } from './db';
import { uuidv7 } from './ids';
import { log, serializeError } from './logger';
import type { MessagingProvider } from './providers/messaging';
import type { VoiceProvider } from './providers/voice';
import type { BillingProvider } from './providers/billing';
import type { AiProvider } from './providers/ai';
import type { OutboundWebhookProvider } from './providers/outbound-webhook';

export type OutboxKind =
	| 'message.send'
	| 'webhook.event'
	| 'voice.event'
	| 'billing.usage'
	| 'ai.follow_up.draft'
	| 'outbound_webhook.deliver';
export type WorkerProviders = {
	messaging: MessagingProvider;
	voice: VoiceProvider;
	billing: BillingProvider;
	ai: AiProvider;
	webhook: OutboundWebhookProvider;
};

const MAX_ATTEMPTS = 8;
const LOCK_TIMEOUT_SECONDS = 60;

export async function enqueue(
	sql: Queryable,
	job: { kind: OutboxKind; accountId: string | null; payload: Record<string, unknown>; runAfter?: Date }
): Promise<void> {
	await sql`
		insert into outbox (id, account_id, kind, payload, run_after)
		values (
			${uuidv7()},
			${job.accountId},
			${job.kind},
			${sql.json(job.payload as never)},
			${job.runAfter ?? new Date()}
		)
	`;
}

/** Thrown by a handler to reschedule the job without counting it as a failure. */
export class RetryAt extends Error {
	constructor(readonly runAfter: Date) {
		super('retry later');
	}
}

export type OutboxHandlers = {
	[K in OutboxKind]: (
		sql: Sql,
		providers: WorkerProviders,
		payload: Record<string, unknown>
	) => Promise<void>;
};

type OutboxRow = {
	id: string;
	kind: OutboxKind;
	payload: Record<string, unknown>;
	attempts: number;
};

/** Process pending outbox rows until none are due. Returns the number processed. */
export async function drainOutbox(
	sql: Sql,
	providers: WorkerProviders,
	handlers: OutboxHandlers,
	limit = 50
): Promise<number> {
	let processed = 0;
	while (processed < limit) {
		const rows = await sql<OutboxRow[]>`
			update outbox
			set locked_at = now(), attempts = attempts + 1
			where id = (
				select id from outbox
				where processed_at is null
					and run_after <= now()
					and (locked_at is null or locked_at < now() - make_interval(secs => ${LOCK_TIMEOUT_SECONDS}))
				order by run_after asc
				limit 1
				for update skip locked
			)
			returning id, kind, payload, attempts
		`;
		const job = rows[0];
		if (!job) break;
		processed += 1;

		try {
			const handler = handlers[job.kind];
			if (!handler) throw new Error(`unknown outbox kind: ${job.kind}`);
			await handler(sql, providers, job.payload);
			await sql`update outbox set processed_at = now() where id = ${job.id}`;
		} catch (err) {
			if (err instanceof RetryAt) {
				await sql`
					update outbox
					set run_after = ${err.runAfter}, locked_at = null, attempts = attempts - 1
					where id = ${job.id}
				`;
				continue;
			}
			const failedForGood = job.attempts >= MAX_ATTEMPTS;
			const backoffSeconds = Math.min(2 ** job.attempts, 300);
			log('error', 'outbox_job_failed', {
				jobId: job.id,
				kind: job.kind,
				attempts: job.attempts,
				final: failedForGood,
				err: serializeError(err)
			});
			if (failedForGood) {
				await sql`
					update outbox
					set processed_at = now(), last_error = ${String(err).slice(0, 500)}
					where id = ${job.id}
				`;
			} else {
				await sql`
					update outbox
					set run_after = now() + make_interval(secs => ${backoffSeconds}),
						locked_at = null,
						last_error = ${String(err).slice(0, 500)}
					where id = ${job.id}
				`;
			}
		}
	}
	return processed;
}
