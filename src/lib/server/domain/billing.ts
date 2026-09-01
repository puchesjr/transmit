import type { BillingSummary, UsageMetric } from '$lib/types';
import type { AuthContext } from '../context';
import type { Queryable, Sql } from '../db';
import { AppError } from '../errors';
import { enqueue } from '../outbox';
import type { BillingProvider, NormalizedBillingEvent } from '../providers/billing';
import {
	activateDemoSubscription,
	applyCheckoutCompleted,
	applyPaymentFailed,
	applyPaymentPaid,
	applySubscriptionState,
	countLocations,
	countOutboundUsage,
	countQueuedOutbound,
	disableExpiredGrace,
	getBillingAccount,
	getUsageEvent,
	insertBillingAccount,
	insertUsageEvent,
	listLocationUsage,
	markUsageReported
} from '../repos/billing';
import { findUserById } from '../repos/users';

export const TRIAL_DAYS = 14;
export const TRIAL_MESSAGE_CAP = 50;
export const DUNNING_GRACE_DAYS = 3;

function defaultPeriod(now: Date): { start: Date; end: Date } {
	return {
		start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
		end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
	};
}

export async function getBillingSummary(
	sql: Sql,
	provider: BillingProvider,
	ctx: AuthContext
): Promise<BillingSummary> {
	const now = new Date();
	await insertBillingAccount(sql, ctx.accountId);
	await disableExpiredGrace(sql, ctx.accountId, now);
	const billing = await getBillingAccount(sql, ctx.accountId);
	if (!billing) throw new AppError('internal', 'Billing account missing');
	const fallback = defaultPeriod(now);
	const periodStart = billing.current_period_start ?? fallback.start;
	const periodEnd = billing.current_period_end ?? fallback.end;
	const [usage, trialMessagesUsed] = await Promise.all([
		listLocationUsage(sql, ctx.accountId, periodStart, periodEnd),
		countOutboundUsage(sql, ctx.accountId, periodStart)
	]);
	return {
		status: billing.status,
		cardOnFile: billing.card_on_file,
		trialEndsAt: billing.trial_ends_at?.toISOString() ?? null,
		currentPeriodStart: periodStart.toISOString(),
		currentPeriodEnd: periodEnd.toISOString(),
		graceEndsAt: billing.grace_ends_at?.toISOString() ?? null,
		sendingDisabledAt: billing.sending_disabled_at?.toISOString() ?? null,
		trialMessageCap: TRIAL_MESSAGE_CAP,
		trialMessagesUsed,
		providerMode: provider.mode,
		usage
	};
}

export async function startCheckout(
	sql: Sql,
	provider: BillingProvider,
	ctx: AuthContext,
	baseUrl: string
): Promise<{ url: string }> {
	await insertBillingAccount(sql, ctx.accountId);
	const [billing, user, locationCount] = await Promise.all([
		getBillingAccount(sql, ctx.accountId),
		findUserById(sql, ctx.userId),
		countLocations(sql, ctx.accountId)
	]);
	if (!billing || !user) throw new AppError('internal', 'Billing checkout could not be started');
	if (billing.status === 'active' || billing.status === 'trialing') {
		throw new AppError('conflict', 'This workspace already has an active subscription');
	}
	const result = await provider.createCheckout({
		accountId: ctx.accountId,
		email: user.email,
		locationCount,
		customerId: billing.provider_customer_id,
		successUrl: `${baseUrl}/settings/billing?checkout=success`,
		cancelUrl: `${baseUrl}/settings/billing?checkout=canceled`
	});
	if (result.demoActivation) {
		await activateDemoSubscription(sql, ctx.accountId, result.demoActivation);
	}
	return { url: result.url };
}

export async function createPortalSession(
	sql: Sql,
	provider: BillingProvider,
	ctx: AuthContext,
	baseUrl: string
): Promise<{ url: string }> {
	const billing = await getBillingAccount(sql, ctx.accountId);
	if (!billing?.provider_customer_id) throw new AppError('validation', 'Start a subscription first');
	return provider.createPortal({
		customerId: billing.provider_customer_id,
		returnUrl: `${baseUrl}/settings/billing`
	});
}

async function assertEntitled(
	sql: Queryable,
	accountId: string,
	options: { countQueued: boolean }
): Promise<void> {
	const now = new Date();
	await disableExpiredGrace(sql, accountId, now);
	const billing = await getBillingAccount(sql, accountId);
	if (!billing || !billing.card_on_file) {
		throw new AppError('validation', 'Add a payment method and start your trial first');
	}
	if (billing.sending_disabled_at || billing.status === 'canceled' || billing.status === 'unconfigured') {
		throw new AppError('validation', 'Messaging is disabled until billing is restored');
	}
	if (billing.status === 'past_due' && (!billing.grace_ends_at || billing.grace_ends_at <= now)) {
		throw new AppError('validation', 'Messaging is disabled because the payment grace period ended');
	}
	if (billing.status === 'trialing') {
		if (!billing.trial_ends_at || billing.trial_ends_at <= now) {
			throw new AppError('validation', 'Your free trial has ended');
		}
		const periodStart = billing.current_period_start ?? new Date(0);
		const used = await countOutboundUsage(sql, accountId, periodStart);
		const queued = options.countQueued ? await countQueuedOutbound(sql, accountId, periodStart) : 0;
		if (used + queued >= TRIAL_MESSAGE_CAP) {
			throw new AppError('validation', `Your free trial is limited to ${TRIAL_MESSAGE_CAP} sent messages`);
		}
	}
}

export function assertCanProvisionNumber(sql: Queryable, accountId: string): Promise<void> {
	return assertEntitled(sql, accountId, { countQueued: false });
}

export function assertCanQueueMessage(sql: Queryable, accountId: string): Promise<void> {
	return assertEntitled(sql, accountId, { countQueued: true });
}

export function assertCanDispatchMessage(sql: Queryable, accountId: string): Promise<void> {
	return assertEntitled(sql, accountId, { countQueued: false });
}

export async function recordUsage(
	sql: Queryable,
	input: {
		accountId: string;
		locationId: string;
		metric: UsageMetric;
		quantity: number;
		sourceType: string;
		sourceId: string;
		occurredAt?: Date;
	}
): Promise<void> {
	if (input.quantity <= 0) return;
	const event = await insertUsageEvent(sql, { ...input, occurredAt: input.occurredAt ?? new Date() });
	if (!event || event.metric === 'call_second') return;
	await enqueue(sql, {
		kind: 'billing.usage',
		accountId: input.accountId,
		payload: { accountId: input.accountId, usageEventId: event.id }
	});
}

export async function processUsageReport(
	sql: Sql,
	provider: BillingProvider,
	payload: Record<string, unknown>
): Promise<void> {
	const accountId = String(payload.accountId ?? '');
	const usageEventId = String(payload.usageEventId ?? '');
	const [billing, event] = await Promise.all([
		getBillingAccount(sql, accountId),
		getUsageEvent(sql, accountId, usageEventId)
	]);
	if (!event || event.provider_reported_at) return;
	if (!billing?.provider_customer_id) return;
	await provider.reportUsage({
		customerId: billing.provider_customer_id,
		metric: event.metric,
		quantity: event.quantity,
		identifier: event.id,
		occurredAt: event.occurred_at
	});
	await markUsageReported(sql, accountId, event.id);
}

export async function handleBillingWebhook(
	sql: Sql,
	provider: BillingProvider,
	rawBody: string,
	signature: string | null
): Promise<{ accepted: boolean; duplicate: boolean }> {
	let event: NormalizedBillingEvent | null;
	try {
		event = provider.verifyAndParseWebhook(rawBody, signature);
	} catch {
		throw new AppError('unauthorized', 'Invalid billing webhook signature');
	}
	if (!event) return { accepted: true, duplicate: false };

	return sql.begin(async (tx) => {
		const inserted = await tx<{ id: string }[]>`
			insert into provider_events (id) values (${event.eventId})
			on conflict (id) do nothing
			returning id
		`;
		if (inserted.length === 0) return { accepted: true, duplicate: true };
		await insertBillingAccount(tx, event.accountId);
		if (event.type === 'checkout.completed') {
			await applyCheckoutCompleted(tx, event.accountId, event.customerId, event.subscriptionId);
		} else if (event.type === 'subscription.changed') {
			await applySubscriptionState(tx, event.accountId, event);
		} else if (event.type === 'invoice.payment_failed') {
			await applyPaymentFailed(
				tx,
				event.accountId,
				event.customerId,
				new Date(Date.now() + DUNNING_GRACE_DAYS * 24 * 60 * 60 * 1000)
			);
		} else {
			await applyPaymentPaid(tx, event.accountId, event.customerId);
		}
		return { accepted: true, duplicate: false };
	});
}
