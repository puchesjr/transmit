import { expect, it } from 'vitest';
import { compareMessageCost } from '$lib/server/domain/message-cost';
const base = {smsCostPerSegmentMicros:8500,mmsCostMicros:25000,smsCustomerCreditsPerSegment:1,mmsCustomerCredits:3,
 mmsSupported:true,rateVerified:true,mmsPayloadValidated:true,mmsAuthorized:true};
it('compares full carrier-inclusive costs and customer credits, not a fixed character threshold',()=>{
 expect(compareMessageCost({...base,body:'a'.repeat(306)}).recommendMms).toBe(false);
 expect(compareMessageCost({...base,body:'a'.repeat(307)})).toMatchObject({segments:3,recommendMms:true,savingsMicros:500});
 expect(compareMessageCost({...base,smsCostPerSegmentMicros:7500,mmsCostMicros:24000,body:'a'.repeat(307)}).recommendMms).toBe(false);
 expect(compareMessageCost({...base,smsCostPerSegmentMicros:7500,mmsCostMicros:24000,body:'a'.repeat(460)}).recommendMms).toBe(true);
});
it('requires verified capability, rates, payload support and customer authorization; avoids ties and higher customer credits',()=>{
 for(const key of ['mmsSupported','rateVerified','mmsPayloadValidated','mmsAuthorized']) expect(compareMessageCost({...base,body:'a'.repeat(460),[key]:false}).recommendMms).toBe(false);
 expect(compareMessageCost({...base,body:'a'.repeat(307),mmsCustomerCredits:4}).recommendMms).toBe(false);
 expect(compareMessageCost({...base,body:'a'.repeat(307),mmsCostMicros:25500}).recommendMms).toBe(false);
 expect(compareMessageCost({...base,body:'😀'.repeat(100)}).recommendMms).toBe(false);
 expect(()=>compareMessageCost({...base,body:'text',mmsCostMicros:-1})).toThrow();
});
