import { LAUNCH_PRICE, TELECOM_PRICE } from '$lib/pricing';
import type { AuthContext } from '../context';
import type { Queryable, Sql } from '../db';
import { AppError } from '../errors';
import { uuidv7 } from '../ids';
import { enqueue, RetryAt } from '../outbox';
import type { BillingProvider } from '../providers/billing';
import { getBillingProvider, liveCarrierConfigured } from '../providers/billing';
import { getBillingAccount, listUnreportedBillableMessages, markUsageReported } from '../repos/billing';
import { subscriptionMetersUsage } from './billing';
import { acceptTelecomTerms, ensureTelecomCharge, getTelecomCharge, getTelecomResource, getTelecomTerms, listTelecomCharges, storeTelecomInvoice, type TelecomCharge, type TelecomResource } from '../repos/telecom';

export async function acceptFeeSchedule(sql: Sql, ctx: AuthContext, version: unknown): Promise<void> {
 if (ctx.role !== 'owner') throw new AppError('forbidden', 'Only the workspace owner can accept telecom fees.');
 if (version !== TELECOM_PRICE.version) throw new AppError('validation', 'Review and accept the current telecom fee schedule.');
 await sql.begin(async tx => {
  await acceptTelecomTerms(tx, ctx.accountId, ctx.userId, TELECOM_PRICE.version);
  const numbers = await tx<{id:string;location_id:string}[]>`select id,location_id from phone_numbers where account_id = ${ctx.accountId} and status = 'active'`;
  const campaigns = await tx<{id:string}[]>`select id from messaging_registrations where account_id = ${ctx.accountId} and provider_campaign_id is not null`;
  for (const number of numbers) await startTelecomResource(tx,{...ctx,locationId:number.location_id},'number',number.id,0);
  for (const campaign of campaigns) await startTelecomResource(tx,ctx,'campaign',campaign.id,0);
 });
}
export async function telecomSummary(sql: Queryable, accountId: string) {
 const charges = await listTelecomCharges(sql, accountId);
 return { acceptedVersion: await getTelecomTerms(sql, accountId), schedule: TELECOM_PRICE,
 charges: charges.map(c => ({id:c.id,description:c.description,amountCents:c.amount_cents,status:c.status,invoiceUrl:c.invoice_url})) };
}
/** An invoice is durable before a provider operation; a retry never creates a second charge. */
export async function requireTelecomPayment(sql: Sql, ctx: AuthContext, key: string, description: string, cents: number) {
 if (ctx.role !== 'owner') throw new AppError('forbidden', 'Only the workspace owner can purchase telecom services.');
 const billingProvider = await getBillingProvider();
 if (billingProvider.mode === 'demo' && liveCarrierConfigured()) {
  throw new AppError('validation', 'Stripe billing is required before purchasing live carrier services.');
 }
 const version = await getTelecomTerms(sql, ctx.accountId);
 if (version !== TELECOM_PRICE.version) throw new AppError('validation', 'Accept telecom fees before continuing.');
 const billing = await getBillingAccount(sql, ctx.accountId);
 if (!billing?.provider_customer_id || !billing.card_on_file) throw new AppError('validation', 'Start billing before purchasing telecom services.');
 const charge = await sql.begin(async tx => {
  const row = await ensureTelecomCharge(tx,{accountId:ctx.accountId,locationId:ctx.locationId,key,description,cents,version});
  if (row.status === 'pending') await enqueue(tx,{kind:'billing.telecom',accountId:ctx.accountId,payload:{accountId:ctx.accountId,chargeId:row.id}});
  return row;
 });
 if (charge.status === 'review') throw new AppError('conflict', 'This paid request needs support review before it can be retried. You will not be charged again.');
 await processTelecomCharge(sql, await getBillingProvider(), {accountId:ctx.accountId,chargeId:charge.id});
 const updated = await getTelecomCharge(sql, ctx.accountId, charge.id);
 if (updated?.status !== 'paid') throw new AppError('validation', 'Pay the telecom invoice shown below or in Billing, then retry this step.');
 return charge.id;
}
export async function processTelecomCharge(sql: Sql, provider: BillingProvider, payload: Record<string,unknown>): Promise<void> {
 const accountId = String(payload.accountId ?? ''); const chargeId = String(payload.chargeId ?? '');
 const charge = await getTelecomCharge(sql,accountId,chargeId);
 if (!charge || charge.status !== 'pending') return;
 const billing = await getBillingAccount(sql,accountId);
 if (!billing?.provider_customer_id) throw new Error('Telecom billing customer missing');
 const save = async (invoiceId: string) => storeTelecomInvoice(sql,accountId,chargeId,invoiceId,null,false);
 const result = await provider.collectTelecomCharge({
  accountId, customerId:billing.provider_customer_id, subscriptionId:billing.provider_subscription_id, identifier:charge.id, invoiceId:charge.provider_invoice_id,
  description:charge.description, amountCents:charge.amount_cents, createdAt:charge.created_at, onInvoiceCreated:save
 });
 await storeTelecomInvoice(sql,accountId,chargeId,result.invoiceId,result.url,result.paid);
}
export function addMonths(date: Date, months: number): Date {
 const result = new Date(date); const day = result.getUTCDate();
 result.setUTCDate(1); result.setUTCMonth(result.getUTCMonth()+months);
 const last = new Date(Date.UTC(result.getUTCFullYear(),result.getUTCMonth()+1,0)).getUTCDate();
 result.setUTCDate(Math.min(day,last)); return result;
}
export async function startTelecomResource(sql: Queryable, ctx: AuthContext, kind: 'campaign'|'number', resourceId: string, prepaidMonths = kind === 'campaign' ? TELECOM_PRICE.campaignInitialMonths : 1) {
 const id = uuidv7(); const until = addMonths(new Date(),prepaidMonths);
 const cents = kind === 'campaign' ? TELECOM_PRICE.campaignMonthlyCents : TELECOM_PRICE.numberMonthlyCents;
 const rows = await sql`insert into telecom_resources(id,account_id,location_id,kind,resource_id,monthly_cents,terms_version,billed_until)
 values(${id},${ctx.accountId},${ctx.locationId},${kind},${resourceId},${cents},${TELECOM_PRICE.version},${until})
 on conflict(account_id,kind,resource_id) do nothing returning id`;
 if (rows.length) await enqueue(sql,{kind:'billing.telecom.renew',accountId:ctx.accountId,payload:{accountId:ctx.accountId,resourceId:id,period:until.toISOString()},runAfter:until});
}
async function resourceStillActive(
	sql: Queryable,
	accountId: string,
	resource: TelecomResource
): Promise<boolean> {
	const active =
		resource.kind === 'number'
			? await sql`select id from phone_numbers where account_id = ${accountId} and id = ${resource.resource_id} and status = 'active'`
			: await sql`select id from messaging_registrations where account_id = ${accountId} and id = ${resource.resource_id} and provider_campaign_id is not null`;
	return active.length > 0;
}

export async function renewTelecomResource(sql: Sql, provider: BillingProvider, payload: Record<string,unknown>) {
 const accountId = String(payload.accountId ?? ''); const id = String(payload.resourceId ?? '');
 const resource = await getTelecomResource(sql,accountId,id);
 if (!resource || resource.billed_until.toISOString() !== payload.period) return;
 if (resource.billed_until > new Date()) throw new RetryAt(resource.billed_until);
 // Resources incur rental charges until actually released, including canceled software subscriptions.
 if (!(await resourceStillActive(sql, accountId, resource))) return;
 const prepared = await sql.begin(async tx => {
  await tx`select id from telecom_resources where account_id = ${accountId} for update`;
  const dueRows = await tx<TelecomResource[]>`
   select * from telecom_resources where account_id = ${accountId} and billed_until <= now()
   order by billed_until asc, id asc`;
  const due: TelecomResource[] = [];
  for (const row of dueRows) {
   if (await resourceStillActive(tx, accountId, row)) due.push(row);
  }
  if (!due.length) return null;
  const key = due.length === 1
   ? `renew:${due[0].id}:${due[0].billed_until.toISOString()}`
   : `renew:${accountId}:${due.map((row) => `${row.id}:${row.billed_until.toISOString()}`).join('|')}`;
  const existing = await tx<TelecomCharge[]>`select * from telecom_charges where account_id = ${accountId} and charge_key = ${key}`;
  if (existing[0]) return { charge: existing[0], due };
  const billing = await getBillingAccount(tx, accountId);
  const recoverSms = !subscriptionMetersUsage(billing);
  let rentalCents = 0;
  let voiceMicros = 0;
  let smsCents = 0;
  const labels: string[] = [];
  const voiceIds: string[] = [];
  const usageIds: string[] = [];
  for (const row of due) {
   rentalCents += row.monthly_cents;
   labels.push(row.kind === 'number' ? 'local number rental' : '10DLC Low Volume Mixed campaign');
   if (row.kind !== 'number') continue;
   const costs = await tx<{id:string;cost_usd:string}[]>`select id,cost_usd from voice_costs
    where account_id = ${accountId} and location_id = ${row.location_id} and charge_id is null and not needs_review
     and occurred_at >= (select created_at from telecom_resources where account_id = ${accountId} and id = ${row.id})
     and occurred_at < ${row.billed_until} for update`;
   voiceMicros += costs.reduce((sum,c)=>sum + usdMicros(c.cost_usd),0);
   voiceIds.push(...costs.map((cost) => cost.id));
   if (recoverSms) {
    const events = await listUnreportedBillableMessages(tx, accountId, row.location_id);
    smsCents += events.reduce((sum, event) => sum + event.billable_quantity * LAUNCH_PRICE.messageCents, 0);
    usageIds.push(...events.map((event) => event.id));
   }
  }
  const voiceCents = Math.ceil(voiceMicros / 10_000);
  const extras = [
   voiceCents ? `voice usage $${(voiceCents / 100).toFixed(2)}` : '',
   smsCents ? `SMS overage $${(smsCents / 100).toFixed(2)}` : ''
  ].filter(Boolean);
  const created = await ensureTelecomCharge(tx,{
   accountId,
   locationId: due[0].location_id,
   key,
   description: `Monthly ${labels.join(' + ')} (${due[0].billed_until.toISOString().slice(0,10)})${extras.length ? ` + ${extras.join(' + ')}` : ''}`,
   cents: rentalCents + voiceCents + smsCents,
   version: due[0].terms_version
  });
  if (voiceIds.length) await tx`update voice_costs set charge_id = ${created.id} where account_id = ${accountId} and id in ${tx(voiceIds)} and charge_id is null`;
  for (const usageId of usageIds) await markUsageReported(tx, accountId, usageId);
  return { charge: created, due };
 });
 if (!prepared) return;
 await processTelecomCharge(sql,provider,{accountId,chargeId:prepared.charge.id});
 if ((await getTelecomCharge(sql,accountId,prepared.charge.id))?.status !== 'paid') throw new RetryAt(new Date(Date.now()+3600_000));
 await sql.begin(async tx => {
  for (const row of prepared.due) {
   const next = addMonths(row.billed_until,1);
   const changed = await tx`update telecom_resources set billed_until = ${next}
    where account_id = ${accountId} and id = ${row.id} and billed_until = ${row.billed_until} returning id`;
   if (changed.length) await enqueue(tx,{kind:'billing.telecom.renew',accountId,payload:{accountId,resourceId:row.id,period:next.toISOString()},runAfter:next});
  }
 });
}

export function usdMicros(value: string): number {
 if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error('Invalid USD precision');
 const [whole, fraction=''] = value.split('.');
 const micros = Number(whole)*1_000_000 + Number(fraction.padEnd(6,'0'));
 if (!Number.isSafeInteger(micros)) throw new Error('USD amount exceeds safe range');
 return micros;
}

export async function recordVoiceCost(sql: Queryable, call: import('../repos/calls').CallRecord, event: import('../providers/voice').NormalizedVoiceWebhookEvent) {
 if (event.costUsd == null || event.billedSeconds == null || !event.costParts || !event.callLegId) throw new Error('Incomplete voice cost');
 const partsTotal = event.costParts.reduce((sum,part)=>sum+usdMicros(part.cost),0);
 const needsReview = partsTotal !== usdMicros(event.costUsd);
 await sql`insert into voice_costs(id,account_id,location_id,call_id,provider_leg_id,cost_usd,billed_seconds,cost_parts,occurred_at,needs_review)
 values(${uuidv7()},${call.accountId},${call.locationId},${call.id},${event.callLegId},${event.costUsd},${event.billedSeconds},${sql.json(event.costParts as never)},${event.occurredAt},${needsReview})
 on conflict(account_id,provider_leg_id) do update set needs_review = voice_costs.needs_review or voice_costs.cost_usd <> excluded.cost_usd or excluded.needs_review`;
}
