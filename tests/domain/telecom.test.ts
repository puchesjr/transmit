import { afterEach, describe, expect, it, vi } from 'vitest';
import { TELECOM_PRICE } from '$lib/pricing';
import { getSql } from '$lib/server/db';
import { acceptFeeSchedule, addMonths, processTelecomCharge, renewTelecomResource, telecomSummary, usdMicros } from '$lib/server/domain/telecom';
import { handleBillingWebhook } from '$lib/server/domain/billing';
import { FAKE_BILLING_SIGNATURE } from '$lib/server/providers/fake-billing';
import { provisionNumber, submitMessagingRegistration } from '$lib/server/domain/messaging';
import { setBillingProvider } from '$lib/server/providers/billing';
import { FakeBillingProvider } from '$lib/server/providers/fake-billing';
import { FakeMessagingProvider } from '$lib/server/providers/fake';
import { activateTestBilling, authContext, createWorkspace, registrationInput } from '../helpers';

const sql = getSql();
afterEach(()=>{setBillingProvider(undefined);vi.restoreAllMocks();vi.unstubAllEnvs();});
async function setup() {
 const workspace = await createWorkspace('telecom');
 const billing = await activateTestBilling(workspace);
 setBillingProvider(billing);
 return {ctx:authContext(workspace),billing,messaging:new FakeMessagingProvider()};
}
describe('telecom payment gate',()=>{
 it('requires explicit owner acceptance; another tenant cannot use a paid charge',async()=>{
  const {ctx,billing,messaging} = await setup();
  await sql`delete from telecom_terms where account_id = ${ctx.accountId}`;
  await expect(submitMessagingRegistration(sql,messaging,ctx,registrationInput())).rejects.toThrow('Accept telecom fees');
  await expect(acceptFeeSchedule(sql,{...ctx,role:'member'},TELECOM_PRICE.version)).rejects.toThrow('owner');
  expect(billing.telecomCharges).toHaveLength(0);
  await acceptFeeSchedule(sql,ctx,TELECOM_PRICE.version);
  await submitMessagingRegistration(sql,messaging,ctx,registrationInput());
  expect(billing.telecomCharges.map(c=>c.amountCents)).toEqual([2400]);
  const stranger=authContext(await createWorkspace('stranger'));
  expect((await telecomSummary(sql,stranger.accountId)).charges).toHaveLength(0);
  await processTelecomCharge(sql,billing,{accountId:stranger.accountId,chargeId:billing.telecomCharges[0].identifier});
  expect(billing.telecomCharges).toHaveLength(1);
 });
 it('does not incur provider costs until payment succeeds, and retries reuse the invoice',async()=>{
  const {ctx,billing,messaging} = await setup(); billing.telecomPaid=false;
  const submit=vi.spyOn(messaging,'submitRegistration');
  await expect(submitMessagingRegistration(sql,messaging,ctx,registrationInput())).rejects.toThrow('Pay the telecom invoice');
  expect(submit).not.toHaveBeenCalled();
  billing.telecomPaid=true;
  await submitMessagingRegistration(sql,messaging,ctx,registrationInput());
  await expect(submitMessagingRegistration(sql,messaging,ctx,registrationInput())).rejects.toThrow('already submitted');
  expect(submit).toHaveBeenCalledTimes(1);
  expect(billing.telecomCharges).toHaveLength(1);
 });
 it('stops ambiguous paid provider operations rather than paying or submitting twice',async()=>{
  const {ctx,billing,messaging}=await setup();
  const submit=vi.spyOn(messaging,'submitRegistration').mockRejectedValue(new Error('network response lost'));
  await expect(submitMessagingRegistration(sql,messaging,ctx,registrationInput())).rejects.toThrow('network response lost');
  await expect(submitMessagingRegistration(sql,messaging,ctx,registrationInput())).rejects.toThrow('support review');
  expect(submit).toHaveBeenCalledTimes(1);
  expect(billing.telecomCharges).toHaveLength(1);
 });
 it('charges one number rental, renews once per period, and preserves paid status on replay',async()=>{
  const {ctx,billing,messaging}=await setup();
  await provisionNumber(sql,messaging,ctx,'+15125551234');
  const [resource]=await sql`select * from telecom_resources where account_id=${ctx.accountId}`;
  const period=new Date(Date.now()-1000);
  await sql`update telecom_resources set billed_until=${period} where account_id=${ctx.accountId} and id=${resource.id}`;
  const payload={accountId:ctx.accountId,resourceId:resource.id,period:period.toISOString()};
  await renewTelecomResource(sql,billing,payload);
  await renewTelecomResource(sql,billing,payload);
  expect(billing.telecomCharges.map(c=>c.amountCents)).toEqual([110,110]);
  expect((await telecomSummary(sql,ctx.accountId)).charges.every(c=>c.status==='paid')).toBe(true);
 });
 it('uses calendar months and integer microdollars',()=>{
  expect(addMonths(new Date('2026-01-31T12:00:00Z'),1).toISOString()).toBe('2026-02-28T12:00:00.000Z');
  expect(usdMicros('0.0065')).toBe(6500);
  expect(()=>usdMicros('1e3')).toThrow();
 });
 it('blocks sending on existing numbers until current terms are accepted', async () => {
  const {ctx} = await setup();
  const {provisionNumber, sendSms} = await import('$lib/server/domain/messaging');
  const {createContact} = await import('$lib/server/domain/contacts');
  const {drainOutbox} = await import('$lib/server/outbox');
  const {outboxHandlers} = await import('$lib/server/worker');
  const {FakeVoiceProvider} = await import('$lib/server/providers/fake');
  const {FakeAiProvider} = await import('$lib/server/providers/fake-ai');
  const {FakeOutboundWebhookProvider} = await import('$lib/server/providers/fake-outbound-webhook');
  const messaging = new FakeMessagingProvider();
  await submitMessagingRegistration(sql, messaging, ctx, registrationInput());
  await provisionNumber(sql, messaging, ctx, '+15125551919');
  await drainOutbox(sql, {messaging, voice: new FakeVoiceProvider(), billing: new FakeBillingProvider(), ai: new FakeAiProvider(), webhook: new FakeOutboundWebhookProvider()}, outboxHandlers);
  await sql`delete from telecom_terms where account_id = ${ctx.accountId}`;
  const contact = await createContact(sql, ctx, {firstName: 'Terms', lastName: 'Gate', email: null, phone: '+15125551918'});
  await expect(sendSms(sql, ctx, contact.id, 'Hello')).rejects.toThrow('Accept carrier fees');
 });
 it('combines due campaign and number rentals on one invoice and recovers SMS after software cancel', async () => {
  const {ctx,billing,messaging} = await setup();
  await submitMessagingRegistration(sql, messaging, ctx, registrationInput());
  await provisionNumber(sql, messaging, ctx, '+15125551917');
  const resources = await sql`select * from telecom_resources where account_id=${ctx.accountId} order by kind`;
  expect(resources).toHaveLength(2);
  const period = new Date(Date.now() - 1000);
  await sql`update telecom_resources set billed_until=${period} where account_id=${ctx.accountId}`;
  await sql`update billing_accounts set status='canceled' where account_id=${ctx.accountId}`;
  const {recordUsage, processUsageReport} = await import('$lib/server/domain/billing');
  await recordUsage(sql, {accountId: ctx.accountId, locationId: ctx.locationId, metric: 'message_inbound', quantity: 253, sourceType: 'message', sourceId: 'cancel-in'});
  const [event] = await sql`select id, billable_quantity from usage_events where account_id=${ctx.accountId} and source_id='cancel-in'`;
  expect(event.billable_quantity).toBe(3);
  await processUsageReport(sql, billing, {accountId: ctx.accountId, usageEventId: event.id});
  expect(billing.reported).toEqual([]);
  const campaign = resources.find((row) => row.kind === 'campaign')!;
  await renewTelecomResource(sql, billing, {accountId: ctx.accountId, resourceId: campaign.id, period: period.toISOString()});
  expect(billing.telecomCharges.map(c => c.amountCents)).toEqual([2400, 110, 266]);
  const [usage] = await sql`select provider_reported_at from usage_events where account_id=${ctx.accountId} and source_id='cancel-in'`;
  expect(usage.provider_reported_at).not.toBeNull();
 });
 it('settles a hosted telecom invoice from Stripe without reactivating software billing', async () => {
  const {ctx,billing,messaging} = await setup();
  billing.telecomPaid=false;
  await expect(submitMessagingRegistration(sql,messaging,ctx,registrationInput())).rejects.toThrow('Pay the telecom invoice');
  const pending=(await telecomSummary(sql,ctx.accountId)).charges[0];
  expect(pending.status).toBe('pending');
  await sql`update billing_accounts set status='canceled' where account_id=${ctx.accountId}`;
  const billingAccount=(await sql`select provider_customer_id from billing_accounts where account_id=${ctx.accountId}`)[0];
  const paid=await handleBillingWebhook(sql,billing,JSON.stringify({
   event:{
    type:'telecom.invoice.paid',
    eventId:`evt-telecom-${pending.id}`,
    accountId:ctx.accountId,
    customerId:billingAccount.provider_customer_id,
    chargeId:pending.id,
    invoiceId:`in_demo_${pending.id}`,
    amountCents:2400,
    invoiceUrl:null
   }
  }),FAKE_BILLING_SIGNATURE);
  expect(paid).toEqual({accepted:true,duplicate:false});
  expect((await telecomSummary(sql,ctx.accountId)).charges[0].status).toBe('paid');
  const [account]=await sql`select status from billing_accounts where account_id=${ctx.accountId}`;
  expect(account.status).toBe('canceled');
  billing.telecomPaid=true;
  await submitMessagingRegistration(sql,messaging,ctx,registrationInput());
  expect((await sql`select status from messaging_registrations where account_id=${ctx.accountId}`)[0].status).toBe('approved');
 });
 it('refuses demo billing when live Telnyx is configured', async () => {
  const {ctx} = await setup();
  vi.stubEnv('TELNYX_API_KEY', 'KEY');
  vi.stubEnv('MESSAGING_PROVIDER', 'telnyx');
  await expect(submitMessagingRegistration(sql, new FakeMessagingProvider(), ctx, registrationInput())).rejects.toThrow('Stripe billing');
  vi.unstubAllEnvs();
 });
});
