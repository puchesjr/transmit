import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BillingProvider } from '$lib/server/providers/billing';
const mock = vi.hoisted(()=>({subscriptions:{retrieve:vi.fn()},invoices:{create:vi.fn(),retrieve:vi.fn(),listLineItems:vi.fn(),finalizeInvoice:vi.fn(),pay:vi.fn()},invoiceItems:{create:vi.fn()},webhooks:{constructEvent:vi.fn()}}));
vi.mock('stripe',()=>{
 class StripeCardError extends Error {}
 class StripeInvalidRequestError extends Error {}
 return {default:class {static errors={StripeCardError,StripeInvalidRequestError};subscriptions=mock.subscriptions;invoices=mock.invoices;invoiceItems=mock.invoiceItems;webhooks=mock.webhooks;}};
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
it('does not let a telecom invoice paid webhook activate a canceled software subscription',()=>{
 mock.webhooks.constructEvent.mockReturnValue({type:'invoice.paid',data:{object:{metadata:{accountId:'account-one',telecomChargeId:'charge-one'},customer:'cus_one'}}});
 expect(new StripeBillingProvider().verifyAndParseWebhook('{}','signature')).toBeNull();
});

it('uses the subscription card for standalone telecom invoices and preserves an SCA payment link',async()=>{
 mock.subscriptions.retrieve.mockResolvedValue({customer:'cus_one',default_payment_method:'pm_saved'});
 const Stripe = (await import('stripe')).default;
 mock.invoices.pay.mockRejectedValue(new Stripe.errors.StripeCardError({message:'Authentication required'}));
 const result=await new StripeBillingProvider().collectTelecomCharge({...input(),subscriptionId:'sub_one'});
 expect(mock.invoices.create).toHaveBeenCalledWith(expect.objectContaining({default_payment_method:'pm_saved'}),expect.anything());
 expect(result).toMatchObject({paid:false,url:'https://invoice.stripe.com/test'});
});
