import type { Queryable } from '../db';
import { uuidv7 } from '../ids';
export type TelecomCharge = {
 id: string; account_id: string; location_id: string; charge_key: string; description: string;
 amount_cents: number; terms_version: string; status: 'pending' | 'paid' | 'review';
 provider_invoice_id: string | null; invoice_url: string | null;
 operation_started_at: Date | null; created_at: Date;
};
export async function getTelecomTerms(sql: Queryable, accountId: string) {
 const rows = await sql<{version: string}[]>`select version from telecom_terms where account_id = ${accountId}`;
 return rows[0]?.version ?? null;
}
export async function acceptTelecomTerms(sql: Queryable, accountId: string, userId: string, version: string) {
 await sql`insert into telecom_terms(account_id,version,accepted_by) values(${accountId},${version},${userId})
 on conflict(account_id) do update set version = excluded.version, accepted_by = excluded.accepted_by, accepted_at = now()`;
}
export async function getTelecomCharge(sql: Queryable, accountId: string, id: string) {
 const rows = await sql<TelecomCharge[]>`select * from telecom_charges where account_id = ${accountId} and id = ${id}`;
 return rows[0] ?? null;
}
export async function listTelecomCharges(sql: Queryable, accountId: string) {
 return sql<TelecomCharge[]>`select * from telecom_charges where account_id = ${accountId} order by created_at desc limit 100`;
}
export async function ensureTelecomCharge(sql: Queryable, input: {accountId: string; locationId: string; key: string; description: string; cents: number; version: string}) {
 const rows = await sql<TelecomCharge[]>`insert into telecom_charges(id,account_id,location_id,charge_key,description,amount_cents,terms_version)
 values(${uuidv7()},${input.accountId},${input.locationId},${input.key},${input.description},${input.cents},${input.version})
 on conflict(account_id,charge_key) do update set charge_key = excluded.charge_key returning *`;
 return rows[0];
}
export async function storeTelecomInvoice(sql: Queryable, accountId: string, id: string, invoiceId: string, url: string | null, paid: boolean) {
 await sql`update telecom_charges set provider_invoice_id = ${invoiceId}, invoice_url = ${url},
 status = case when ${paid} then 'paid' else status end, paid_at = case when ${paid} then coalesce(paid_at,now()) else paid_at end
 where account_id = ${accountId} and id = ${id} and (provider_invoice_id is null or provider_invoice_id = ${invoiceId})`;
}
export async function claimTelecomOperation(sql: Queryable, accountId: string, id: string): Promise<boolean> {
 const rows = await sql`update telecom_charges set operation_started_at = now()
 where account_id = ${accountId} and id = ${id} and status = 'paid' and operation_started_at is null returning id`;
 return rows.length === 1;
}
export async function markTelecomReview(sql: Queryable, accountId: string, id: string) {
 await sql`update telecom_charges set status = 'review' where account_id = ${accountId} and id = ${id}`;
}
export type TelecomResource = { id: string; account_id: string; location_id: string; kind: 'campaign' | 'number'; resource_id: string; monthly_cents: number; terms_version: string; billed_until: Date };
export async function getTelecomResource(sql: Queryable, accountId: string, id: string) {
 const rows = await sql<TelecomResource[]>`select * from telecom_resources where account_id = ${accountId} and id = ${id}`;
 return rows[0] ?? null;
}
