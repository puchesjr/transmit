import { smsMetrics } from '../../sms';

/** Recommendation only. Rates must include carrier fees, use integer micro-USD,
 * and come from a verified rate sheet for this destination. No sending side effects.
 */
export function compareMessageCost(input: {
	body: string;
	smsCostPerSegmentMicros: number;
	mmsCostMicros: number;
	smsCustomerCreditsPerSegment: number;
	mmsCustomerCredits: number;
	mmsSupported: boolean;
	rateVerified: boolean;
	mmsPayloadValidated: boolean;
	mmsAuthorized: boolean;
	additionalMmsCostMicros?: number;
}) {
	const metrics = smsMetrics(input.body);
	const values = [input.smsCostPerSegmentMicros, input.mmsCostMicros,
		input.smsCustomerCreditsPerSegment, input.mmsCustomerCredits, input.additionalMmsCostMicros ?? 0];
	if (values.some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('Costs and credits must be nonnegative integers');
	const smsCostMicros = metrics.segments * input.smsCostPerSegmentMicros;
	const mmsCostMicros = input.mmsCostMicros + (input.additionalMmsCostMicros ?? 0);
	const smsCustomerCredits = metrics.segments * input.smsCustomerCreditsPerSegment;
	if (![smsCostMicros,mmsCostMicros,smsCustomerCredits].every(Number.isSafeInteger)) throw new Error('Cost calculation overflow');
	const eligible = metrics.encoding === 'GSM-7' && metrics.segments > 0 && input.mmsSupported &&
		input.rateVerified && input.mmsPayloadValidated && input.mmsAuthorized;
	const recommendMms = eligible && mmsCostMicros < smsCostMicros && input.mmsCustomerCredits <= smsCustomerCredits;
	return { ...metrics, smsCostMicros, mmsCostMicros, smsCustomerCredits,
		mmsCustomerCredits: input.mmsCustomerCredits, recommendMms,
		savingsMicros: recommendMms ? smsCostMicros - mmsCostMicros : 0 };
}
