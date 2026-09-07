import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BillingProvider } from '$lib/server/providers/billing';
const mock = vi.hoisted(()=>({subscriptions:{retrieve:vi.fn()},invoices:{create:vi.fn(),retrieve:vi.fn(),listLineItems:vi.fn(),finalizeInvoice:vi.fn(),pay:vi.fn()},invoiceItems:{create:vi.fn()},prices:{retrieve:vi.fn()},webhooks:{constructEvent:vi.fn()}}));
vi.mock('stripe',()=>{
 class StripeCardError extends Error {}
 class StripeInvalidRequestError extends Error {}
 return {default:class {static errors={StripeCardError,StripeInvalidRequestError};subscriptions=mock.subscriptions;invoices=mock.invoices;invoiceItems=mock.invoiceItems;prices=mock.prices;webhooks=mock.webhooks;}};
});
import { StripeBillingProvider } from '$lib/server/providers/stripe-billing';
let state: Record<string,unknown>;
beforeEach(()=>{
 vi.resetAllMocks();
 for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_LOCATION_PRICE_ID','STRIPE_MESSAGE_PRICE_ID','STRIPE_MESSAGE_METER_EVENT_NAME']) vi.stubEnv(key,'test-only');
 state={id:'in_one',customer:'cus_one',status:'draft',total:2400,metadata:{telecomChargeId:'charge-one'},hosted_invoice_url:'https://invoice.stripe.com/test'};
 mock.invoices.create.mockImplementation(async()=>({...state}));
 mock.invoices.retrieve.mockImplementation(async()=>({...state}));
 mock.invoices.listLineItems.mockResolvedValue({data:[]});
 mock.invoiceItems.create.mockResolvedValue({id:'item-one'});
 mock.invoices.finalizeInvoice.mockImplementation(async()=>{state.status='open';return {...state};});
 mock.invoices.pay.mockImplementation(async()=>{state.status='paid';return {...state};});
 mock.prices.retrieve.mockResolvedValue({
  id:'price_message',
  unit_amount:2,
  currency:'usd',
  billing_scheme:'per_unit',
  recurring:{usage_type:'metered'},
  transform_quantity:null
 });
});
afterEach(()=>vi.unstubAllEnvs());
function input(): Parameters<BillingProvider['collectTelecomCharge']>[0] {
 return {accountId:'account-one',customerId:'cus_one',identifier:'charge-one',invoiceId:null,description:'Registration',amountCents:2400,createdAt:new Date(),onInvoiceCreated:vi.fn(async()=>{})};
}
it('persists the invoice id before adding charges; excludes unrelated items and uses stable idempotency keys',async()=>{
 const arg=input(); const result=await new StripeBillingProvider().collectTelecomCharge(arg);
 expect(result.paid).toBe(true);
 expect(arg.onInvoiceCreated).toHaveBeenCalledWith('in_one');
 expect(mock.invoices.create).toHaveBeenCalledWith(expect.objectContaining({pending_invoice_items_behavior:'exclude',auto_advance:false}),{idempotencyKey:'telecom:charge-one:invoice'});
 expect(mock.invoiceItems.create).toHaveBeenCalledWith(expect.objectContaining({amount:2400,invoice:'in_one'}),{idempotencyKey:'telecom:charge-one:item'});
 const replay=await new StripeBillingProvider().collectTelecomCharge({...arg,invoiceId:'in_one'});
 expect(replay.paid).toBe(true); expect(mock.invoiceItems.create).toHaveBeenCalledTimes(1); expect(mock.invoices.pay).toHaveBeenCalledTimes(1);
});
it('rejects a different customer, a wrong amount, and stale ambiguous invoice creation',async()=>{
 state.customer='cus_other';
 await expect(new StripeBillingProvider().collectTelecomCharge({...input(),invoiceId:'in_one'})).rejects.toThrow('ownership');
 state.customer='cus_one'; state.total=9999;
 await expect(new StripeBillingProvider().collectTelecomCharge({...input(),invoiceId:'in_one'})).rejects.toThrow('amount');
 await expect(new StripeBillingProvider().collectTelecomCharge({...input(),createdAt:new Date(0)})).rejects.toThrow('reconciliation');
 expect(mock.invoices.pay).not.toHaveBeenCalled();
});
it('parses a telecom invoice.paid webhook without treating it as a software invoice',()=>{
 mock.webhooks.constructEvent.mockReturnValue({
  id:'evt_telecom_paid',
  type:'invoice.paid',
  data:{object:{
   id:'in_one',
   customer:'cus_one',
   amount_paid:2400,
   total:2400,
   hosted_invoice_url:'https://invoice.stripe.com/test',
   metadata:{accountId:'account-one',telecomChargeId:'charge-one'}
  }}
 });
 expect(new StripeBillingProvider().verifyAndParseWebhook('{}','signature')).toEqual({
  type:'telecom.invoice.paid',
  eventId:'evt_telecom_paid',
  accountId:'account-one',
  customerId:'cus_one',
  chargeId:'charge-one',
  invoiceId:'in_one',
  amountCents:2400,
  invoiceUrl:'https://invoice.stripe.com/test'
 });
});

it('refuses a message meter price that is not two cents per segment',async()=>{
 mock.prices.retrieve.mockResolvedValue({
  id:'price_message',
  unit_amount:2,
  currency:'usd',
  billing_scheme:'tiered',
  recurring:{usage_type:'metered'},
  transform_quantity:null
 });
 await expect(new StripeBillingProvider().collectTelecomCharge(input())).rejects.toThrow('per-unit price');
});

it('uses the subscription card for standalone telecom invoices and preserves an SCA payment link',async()=>{
 mock.subscriptions.retrieve.mockResolvedValue({customer:'cus_one',default_payment_method:'pm_saved'});
 const Stripe = (await import('stripe')).default;
 mock.invoices.pay.mockRejectedValue(new Stripe.errors.StripeCardError({message:'Authentication required'}));
 const result=await new StripeBillingProvider().collectTelecomCharge({...input(),subscriptionId:'sub_one'});
 expect(mock.invoices.create).toHaveBeenCalledWith(expect.objectContaining({default_payment_method:'pm_saved'}),expect.anything());
 expect(result).toMatchObject({paid:false,url:'https://invoice.stripe.com/test'});
});
