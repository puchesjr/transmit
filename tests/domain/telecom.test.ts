import { afterEach, describe, expect, it, vi } from 'vitest';
import { TELECOM_PRICE } from '$lib/pricing';
import { getSql } from '$lib/server/db';
import { acceptFeeSchedule, addMonths, processTelecomCharge, renewTelecomResource, telecomSummary, usdMicros } from '$lib/server/domain/telecom';
import { provisionNumber, submitMessagingRegistration } from '$lib/server/domain/messaging';
import { setBillingProvider } from '$lib/server/providers/billing';
import { FakeBillingProvider } from '$lib/server/providers/fake-billing';
import { FakeMessagingProvider } from '$lib/server/providers/fake';
import { activateTestBilling, authContext, createWorkspace, registrationInput } from '../helpers';

const sql = getSql();
afterEach(()=>{setBillingProvider(undefined);vi.restoreAllMocks();});
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
});
