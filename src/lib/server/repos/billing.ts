import type { BillingStatus, LocationUsage, UsageMetric } from '$lib/types';
import type { Queryable } from '../db';
import { uuidv7 } from '../ids';

export type BillingAccountRow = {
	id: string;
	account_id: string;
	status: BillingStatus;
	provider_customer_id: string | null;
	provider_subscription_id: string | null;
	card_on_file: boolean;
	trial_ends_at: Date | null;
	current_period_start: Date | null;
	current_period_end: Date | null;
	grace_ends_at: Date | null;
	sending_disabled_at: Date | null;
};

export type UsageEventRow = {
	id: string;
	account_id: string;
	location_id: string;
	metric: UsageMetric;
	quantity: number;
	source_type: string;
	source_id: string;
	occurred_at: Date;
	provider_reported_at: Date | null;
};

const BILLING_COLUMNS = [
	'id',
	'account_id',
	'status',
	'provider_customer_id',
	'provider_subscription_id',
	'card_on_file',
	'trial_ends_at',
	'current_period_start',
	'current_period_end',
	'grace_ends_at',
	'sending_disabled_at'
] as const;

export async function insertBillingAccount(sql: Queryable, accountId: string): Promise<void> {
	await sql`
		insert into billing_accounts (id, account_id)
		values (${accountId}, ${accountId})
		on conflict (account_id) do nothing
	`;
}

export async function getBillingAccount(
	sql: Queryable,
	accountId: string
): Promise<BillingAccountRow | null> {
	const rows = await sql<BillingAccountRow[]>`
		select ${sql(BILLING_COLUMNS as unknown as string[])}
		from billing_accounts
		where account_id = ${accountId}
		limit 1
	`;
	return rows[0] ?? null;
}

export async function activateDemoSubscription(
	sql: Queryable,
	accountId: string,
	input: {
		customerId: string;
		subscriptionId: string;
		trialEndsAt: Date;
		currentPeriodStart: Date;
		currentPeriodEnd: Date;
	}
): Promise<void> {
	await sql`
		update billing_accounts
		set status = 'trialing', provider_customer_id = ${input.customerId},
			provider_subscription_id = ${input.subscriptionId}, card_on_file = true,
			trial_ends_at = ${input.trialEndsAt}, current_period_start = ${input.currentPeriodStart},
			current_period_end = ${input.currentPeriodEnd}, grace_ends_at = null,
			sending_disabled_at = null, updated_at = now()
		where account_id = ${accountId}
	`;
}

export async function applyCheckoutCompleted(
	sql: Queryable,
	accountId: string,
	customerId: string,
	subscriptionId: string
): Promise<void> {
	await sql`
		update billing_accounts
		set provider_customer_id = ${customerId}, provider_subscription_id = ${subscriptionId},
			card_on_file = true, updated_at = now()
		where account_id = ${accountId}
	`;
}

export async function applySubscriptionState(
	sql: Queryable,
	accountId: string,
	input: {
		customerId: string;
		subscriptionId: string;
		status: BillingStatus;
		cardOnFile: boolean;
		trialEndsAt: Date | null;
		currentPeriodStart: Date | null;
		currentPeriodEnd: Date | null;
	}
): Promise<void> {
	await sql`
		update billing_accounts
		set provider_customer_id = ${input.customerId},
			provider_subscription_id = ${input.subscriptionId}, status = ${input.status},
			card_on_file = ${input.cardOnFile}, trial_ends_at = ${input.trialEndsAt},
			current_period_start = coalesce(${input.currentPeriodStart}, current_period_start),
			current_period_end = coalesce(${input.currentPeriodEnd}, current_period_end),
			grace_ends_at = case when ${input.status} in ('active', 'trialing') then null else grace_ends_at end,
			sending_disabled_at = case when ${input.status} in ('active', 'trialing') then null else sending_disabled_at end,
			updated_at = now()
		where account_id = ${accountId}
	`;
}

export async function applyPaymentFailed(
	sql: Queryable,
	accountId: string,
	customerId: string,
	graceEndsAt: Date
): Promise<void> {
	await sql`
		update billing_accounts
		set status = 'past_due', grace_ends_at = ${graceEndsAt}, updated_at = now()
		where account_id = ${accountId} and provider_customer_id = ${customerId}
	`;
}

export async function applyPaymentPaid(
	sql: Queryable,
	accountId: string,
	customerId: string
): Promise<void> {
	await sql`
		update billing_accounts
		set status = 'active', grace_ends_at = null, sending_disabled_at = null,
			card_on_file = true, updated_at = now()
		where account_id = ${accountId} and provider_customer_id = ${customerId}
	`;
}

export async function disableExpiredGrace(
	sql: Queryable,
	accountId: string,
	now: Date
): Promise<void> {
	await sql`
		update billing_accounts
		set sending_disabled_at = ${now}, updated_at = now()
		where account_id = ${accountId} and status = 'past_due'
			and grace_ends_at is not null and grace_ends_at <= ${now}
			and sending_disabled_at is null
	`;
}

export async function countLocations(sql: Queryable, accountId: string): Promise<number> {
	const rows = await sql<{ count: number }[]>`
		select count(*)::int as count from locations where account_id = ${accountId}
	`;
	return rows[0]?.count ?? 0;
}

export async function insertUsageEvent(
	sql: Queryable,
	input: {
		accountId: string;
		locationId: string;
		metric: UsageMetric;
		quantity: number;
		sourceType: string;
		sourceId: string;
		occurredAt: Date;
	}
): Promise<UsageEventRow | null> {
	const rows = await sql<UsageEventRow[]>`
		insert into usage_events (
			id, account_id, location_id, metric, quantity, source_type, source_id, occurred_at
		)
		values (
			${uuidv7()}, ${input.accountId}, ${input.locationId}, ${input.metric}, ${input.quantity},
			${input.sourceType}, ${input.sourceId}, ${input.occurredAt}
		)
		on conflict (account_id, metric, source_type, source_id) do nothing
		returning id, account_id, location_id, metric, quantity::int, source_type, source_id,
			occurred_at, provider_reported_at
	`;
	return rows[0] ?? null;
}

export async function getUsageEvent(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<UsageEventRow | null> {
	const rows = await sql<UsageEventRow[]>`
		select id, account_id, location_id, metric, quantity::int, source_type, source_id,
			occurred_at, provider_reported_at
		from usage_events
		where account_id = ${accountId} and id = ${id}
		limit 1
	`;
	return rows[0] ?? null;
}

export async function markUsageReported(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<void> {
	await sql`
		update usage_events set provider_reported_at = now()
		where account_id = ${accountId} and id = ${id} and provider_reported_at is null
	`;
}

export async function countOutboundUsage(
	sql: Queryable,
	accountId: string,
	periodStart: Date
): Promise<number> {
	const rows = await sql<{ quantity: number }[]>`
		select coalesce(sum(quantity), 0)::int as quantity
		from usage_events
		where account_id = ${accountId} and metric = 'message_outbound'
			and occurred_at >= ${periodStart}
	`;
	return rows[0]?.quantity ?? 0;
}

export async function countQueuedOutbound(
	sql: Queryable,
	accountId: string,
	periodStart: Date
): Promise<number> {
	const rows = await sql<{ count: number }[]>`
		select count(*)::int as count from messages
		where account_id = ${accountId} and direction = 'outbound' and status = 'queued'
			and created_at >= ${periodStart}
	`;
	return rows[0]?.count ?? 0;
}

export async function listLocationUsage(
	sql: Queryable,
	accountId: string,
	periodStart: Date,
	periodEnd: Date
): Promise<LocationUsage[]> {
	const rows = await sql<
		{
			location_id: string;
			location_name: string;
			outbound_messages: number;
			inbound_messages: number;
			call_seconds: number;
		}[]
	>`
		select l.id as location_id, l.name as location_name,
			coalesce(sum(u.quantity) filter (where u.metric = 'message_outbound'), 0)::int as outbound_messages,
			coalesce(sum(u.quantity) filter (where u.metric = 'message_inbound'), 0)::int as inbound_messages,
			coalesce(sum(u.quantity) filter (where u.metric = 'call_second'), 0)::int as call_seconds
		from locations l
		left join usage_events u on u.account_id = ${accountId} and u.location_id = l.id
			and u.occurred_at >= ${periodStart} and u.occurred_at < ${periodEnd}
		where l.account_id = ${accountId}
		group by l.id, l.name
		order by l.name asc
	`;
	return rows.map((row) => ({
		locationId: row.location_id,
		locationName: row.location_name,
		outboundMessages: row.outbound_messages,
		inboundMessages: row.inbound_messages,
		callSeconds: row.call_seconds
	}));
}
