import { LAUNCH_PRICE, TELECOM_PRICE, smsOverageCredits } from '$lib/pricing';
import type { BillingStatus, BillingSummary, UsageMetric } from '$lib/types';
import type { AuthContext } from '../context';
import type { Queryable, Sql } from '../db';
import { AppError } from '../errors';
import { enqueue } from '../outbox';
import type {
	BillingProvider,
	NormalizedBillingEvent,
	SubscriptionChangedEvent
} from '../providers/billing';
import {
	activateDemoSubscription,
	applyCheckoutCompleted,
	applyPaymentFailed,
	applyPaymentPaid,
	applySubscriptionState,
	countLocations,
	countMessageCredits,
	countOutboundUsage,
	countQueuedOutbound,
	disableExpiredGrace,
	getBillingAccount,
	getUsageEvent,
	insertBillingAccount,
	insertUsageEvent,
	listLocationUsage,
	lockBillingAccount,
	markUsageReported,
	setPendingCheckout,
	type BillingAccountRow
} from '../repos/billing';
import { getTelecomCharge, getTelecomTerms, storeTelecomInvoice } from '../repos/telecom';
import { findUserById } from '../repos/users';
import { log, serializeError } from '../logger';
import { asObject, optionalString } from '../validation';

export const TRIAL_DAYS = LAUNCH_PRICE.trialDays;
export const TRIAL_MESSAGE_CAP = LAUNCH_PRICE.trialOutboundMessages;
export const DUNNING_GRACE_DAYS = 3;

function requireBillingOwner(ctx: AuthContext): void {
	if (ctx.role !== 'owner') {
		throw new AppError('forbidden', 'Only the workspace owner can manage billing');
	}
}

function mapBillingProviderError(error: unknown): never {
	if (error instanceof AppError) throw error;
	if (error instanceof Error && /ownership mismatch/i.test(error.message)) {
		throw new AppError('forbidden', 'Checkout session does not belong to this workspace');
	}
	if (error instanceof Error && /already completed/i.test(error.message)) {
		throw new AppError(
			'conflict',
			'Your card is already on file. The trial is still being confirmed; try again in a moment.'
		);
	}
	throw error;
}

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
	if (ctx.role === 'owner') await reconcileStrandedSubscription(sql, provider, ctx.accountId);
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

export type CheckoutReturnTo = 'billing' | 'onboarding';

export function parseCheckout(body: unknown): { returnTo: CheckoutReturnTo } {
	if (body == null) return { returnTo: 'billing' };
	const obj = asObject(body);
	if (obj.returnTo == null || obj.returnTo === '') return { returnTo: 'billing' };
	if (obj.returnTo === 'billing' || obj.returnTo === 'onboarding') return { returnTo: obj.returnTo };
	throw new AppError('validation', 'returnTo is invalid');
}

/** The provider substitutes its own hosted-checkout session id for the placeholder. */
export const CHECKOUT_SESSION_PLACEHOLDER = '{CHECKOUT_SESSION_ID}';

function checkoutUrls(baseUrl: string, returnTo: CheckoutReturnTo): { successUrl: string; cancelUrl: string } {
	const path = returnTo === 'onboarding' ? '/onboarding' : '/settings/billing';
	return {
		successUrl: `${baseUrl}${path}?checkout=success&session_id=${CHECKOUT_SESSION_PLACEHOLDER}`,
		cancelUrl: `${baseUrl}${path}?checkout=canceled`
	};
}

export async function reconcileStrandedSubscription(
	sql: Sql,
	provider: BillingProvider,
	accountId: string
): Promise<void> {
	const billing = await getBillingAccount(sql, accountId);
	if (!billing || billing.status !== 'unconfigured' || !billing.card_on_file) return;
	if (!billing.provider_customer_id || !billing.provider_subscription_id) return;
	try {
		const event = await provider.retrieveSubscription({
			accountId,
			customerId: billing.provider_customer_id,
			subscriptionId: billing.provider_subscription_id
		});
		if (event && event.accountId === accountId) await applySubscriptionState(sql, accountId, event);
	} catch (error) {
		log('warn', 'subscription_reconcile_failed', { accountId, err: serializeError(error) });
	}
}

export function parseCheckoutConfirm(body: unknown): { sessionId: string | null } {
	if (body == null) return { sessionId: null };
	const sessionId = optionalString(asObject(body).sessionId, 'sessionId', 200);
	if (sessionId && !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
		throw new AppError('validation', 'sessionId is invalid');
	}
	return { sessionId };
}

export async function confirmCheckout(
	sql: Sql,
	provider: BillingProvider,
	ctx: AuthContext,
	sessionId: string | null
): Promise<{ status: BillingStatus; confirmed: boolean }> {
	requireBillingOwner(ctx);
	await insertBillingAccount(sql, ctx.accountId);
	const billing = await getBillingAccount(sql, ctx.accountId);
	if (!billing) throw new AppError('internal', 'Billing account missing');
	if (billing.status === 'trialing' || billing.status === 'active') {
		return { status: billing.status, confirmed: true };
	}
	let event: SubscriptionChangedEvent | null = null;
	try {
		if (sessionId) {
			event = await provider.confirmCheckout({ accountId: ctx.accountId, sessionId });
		} else if (billing.provider_customer_id && billing.provider_subscription_id) {
			event = await provider.retrieveSubscription({
				accountId: ctx.accountId,
				customerId: billing.provider_customer_id,
				subscriptionId: billing.provider_subscription_id
			});
		}
	} catch (error) {
		mapBillingProviderError(error);
	}
	if (!event || event.accountId !== ctx.accountId) {
		return { status: billing.status, confirmed: false };
	}
	const applied = event;
	await sql.begin(async (tx) => {
		await lockBillingAccount(tx, ctx.accountId);
		await applySubscriptionState(tx, ctx.accountId, applied);
	});
	const updated = await getBillingAccount(sql, ctx.accountId);
	const status = updated?.status ?? billing.status;
	return { status, confirmed: status === 'trialing' || status === 'active' };
}

export async function startCheckout(
	sql: Sql,
	provider: BillingProvider,
	ctx: AuthContext,
	baseUrl: string,
	options: { returnTo?: CheckoutReturnTo } = {}
): Promise<{ url: string }> {
	requireBillingOwner(ctx);
	await insertBillingAccount(sql, ctx.accountId);
	const [user, locationCount] = await Promise.all([
		findUserById(sql, ctx.userId),
		countLocations(sql, ctx.accountId)
	]);
	if (!user) throw new AppError('internal', 'Billing checkout could not be started');
	const urls = checkoutUrls(baseUrl, options.returnTo ?? 'billing');

	return sql.begin(async (tx) => {
		const billing = await lockBillingAccount(tx, ctx.accountId);
		if (!billing) throw new AppError('internal', 'Billing checkout could not be started');
		if (billing.status === 'active' || billing.status === 'trialing') {
			throw new AppError('conflict', 'This workspace already has an active subscription');
		}
		if (billing.card_on_file) {
			throw new AppError(
				'conflict',
				'Your card is already on file. The trial is still being confirmed; try again in a moment.'
			);
		}
		if (billing.pending_checkout_session_id) {
			try {
				await provider.expireCheckout(billing.pending_checkout_session_id);
			} catch (error) {
				mapBillingProviderError(error);
			}
		}
		const result = await provider.createCheckout({
			accountId: ctx.accountId,
			email: user.email,
			locationCount,
			customerId: billing.provider_customer_id,
			successUrl: urls.successUrl,
			cancelUrl: urls.cancelUrl
		});
		if (result.demoActivation) {
			await activateDemoSubscription(tx, ctx.accountId, result.demoActivation);
		} else {
			await setPendingCheckout(tx, ctx.accountId, result.sessionId);
		}
		return { url: result.url };
	});
}

export async function createPortalSession(
	sql: Sql,
	provider: BillingProvider,
	ctx: AuthContext,
	baseUrl: string
): Promise<{ url: string }> {
	requireBillingOwner(ctx);
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
	options: { countQueued: boolean; segments?: number; enforceSmsCap?: boolean }
): Promise<void> {
	const now = new Date();
	await disableExpiredGrace(sql, accountId, now);
	const billing = await getBillingAccount(sql, accountId);
	if (!billing || !billing.card_on_file) {
		throw new AppError('validation', 'Add a payment method and start your trial first');
	}
	const overdue = await sql`select id from telecom_charges where account_id = ${accountId} and charge_key like 'renew:%'
  and status <> 'paid' and created_at < now() - interval '3 days' limit 1`;
 if (overdue.length) throw new AppError('validation','Communications are disabled until overdue telecom fees are paid.');
	const usingCarrier = await sql`
		(select 1 from phone_numbers where account_id = ${accountId} and status = 'active' limit 1)
		union all
		(select 1 from messaging_registrations where account_id = ${accountId} and provider_campaign_id is not null limit 1)`;
	if (usingCarrier.length) {
		const terms = await getTelecomTerms(sql, accountId);
		if (terms !== TELECOM_PRICE.version) {
			throw new AppError('validation', 'Accept carrier fees before sending or forwarding.');
		}
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
		if (options.enforceSmsCap === false) return;
		const periodStart = billing.current_period_start ?? new Date(0);
		const used = await countOutboundUsage(sql, accountId, periodStart);
		const queued = options.countQueued ? await countQueuedOutbound(sql, accountId, periodStart) : 0;
		if (used + queued + (options.segments ?? 1) > TRIAL_MESSAGE_CAP) {
			throw new AppError('validation', `Your free trial is limited to ${TRIAL_MESSAGE_CAP} outbound SMS segments`);
		}
	}
}

export function assertCanForwardCall(sql: Queryable, accountId: string): Promise<void> {
 return assertEntitled(sql, accountId, {countQueued:false,enforceSmsCap:false});
}

export function assertCanProvisionNumber(sql: Queryable, accountId: string): Promise<void> {
	return assertEntitled(sql, accountId, { countQueued: false });
}

export function assertCanQueueMessage(sql: Queryable, accountId: string, segments = 1): Promise<void> {
	return assertEntitled(sql, accountId, { countQueued: true, segments });
}

export function assertCanDispatchMessage(sql: Queryable, accountId: string, segments = 1): Promise<void> {
	return assertEntitled(sql, accountId, { countQueued: false, segments });
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
	if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) return;
 const root = sql as Sql;
 if (typeof root.begin === 'function') {
  await root.begin(tx => recordUsage(tx,input)); return;
 }
 await sql`select id from billing_accounts where account_id = ${input.accountId} for update`;
 const event = await insertUsageEvent(sql, { ...input, occurredAt: input.occurredAt ?? new Date() });
	if (!event || event.metric === 'call_second') return;
 const billing = await getBillingAccount(sql,input.accountId);
 // Allocate included credits in locked ledger insertion order, so a delayed
 // webhook cannot reuse credits already allocated to a later provider timestamp.
 const periodStart = billing?.current_period_start ?? new Date(0);
 const total = await countMessageCredits(sql,input.accountId,periodStart);
 const prior = total - (event.occurred_at >= periodStart ? event.quantity : 0);
 const billable = smsOverageCredits(prior,event.quantity);
 await sql`update usage_events set billable_quantity = ${billable} where account_id = ${input.accountId} and id = ${event.id}`;
 await enqueue(sql, {
		kind: 'billing.usage',
		accountId: input.accountId,
		payload: { accountId: input.accountId, usageEventId: event.id }
	});
}

export function subscriptionMetersUsage(billing: BillingAccountRow | null): boolean {
	if (!billing?.provider_customer_id) return false;
	if (billing.status === 'canceled' || billing.status === 'unconfigured') return false;
	if (billing.sending_disabled_at) return false;
	return true;
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
	if (!billing || !subscriptionMetersUsage(billing)) return;
	const customerId = billing.provider_customer_id;
	if (!customerId) return;
	let quantity = event.billable_quantity ?? event.quantity;
	if (event.billable_quantity == null && (event.metric === 'message_outbound' || event.metric === 'message_inbound')) {
		const periodStart = billing.current_period_start ?? new Date(0);
		const prior = await countMessageCredits(sql, accountId, periodStart, {
			id: event.id,
			occurredAt: event.occurred_at
		});
		quantity = smsOverageCredits(prior, event.quantity);
		if (quantity <= 0) {
			await markUsageReported(sql, accountId, event.id);
			return;
		}
	}
	if (quantity <= 0) { await markUsageReported(sql,accountId,event.id); return; }
	await provider.reportUsage({
		customerId,
		metric: event.metric,
		quantity,
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
		} else if (event.type === 'invoice.paid') {
			await applyPaymentPaid(tx, event.accountId, event.customerId, {
				subscriptionId: event.subscriptionId,
				amountPaid: event.amountPaid
			});
		} else if (event.type === 'telecom.invoice.paid') {
			await settleTelecomInvoicePaid(tx, event);
		}
		return { accepted: true, duplicate: false };
	});
}

async function settleTelecomInvoicePaid(
	sql: Queryable,
	event: Extract<NormalizedBillingEvent, { type: 'telecom.invoice.paid' }>
): Promise<void> {
	const charge = await getTelecomCharge(sql, event.accountId, event.chargeId);
	const billing = await getBillingAccount(sql, event.accountId);
	if (
		!charge ||
		!billing?.provider_customer_id ||
		billing.provider_customer_id !== event.customerId ||
		charge.amount_cents !== event.amountCents ||
		(charge.provider_invoice_id && charge.provider_invoice_id !== event.invoiceId)
	) {
		log('error', 'telecom_invoice_settlement_rejected', {
			accountId: event.accountId,
			chargeId: event.chargeId,
			invoiceId: event.invoiceId
		});
		return;
	}
	await storeTelecomInvoice(sql, event.accountId, charge.id, event.invoiceId, event.invoiceUrl, true);
}
