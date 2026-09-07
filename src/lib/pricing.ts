export const LAUNCH_PRICE = {
	locationMonthlyDollars: 99,
	/** SMS segments included each billing period (sent + received). */
	includedSmsCredits: 250,
	/**
	 * Stripe metered Price `unit_amount` in cents after the included credits.
	 * Dashboard amount is $0.02. Do not use `0.02 * 100` at charge time.
	 */
	messageCents: 2,
	/** Display dollars for the overage rate. Keep in sync with `messageCents`. */
	messageDollars: 0.02,
	/** MMS burns this many SMS credits when we bill MMS. */
	mmsCreditsPerMessage: 3,
	trialDays: 14,
	trialOutboundMessages: 50
} as const;

/** Credits from this event that Stripe should bill at `messageCents`. */
export function smsOverageCredits(priorCredits: number, quantity: number): number {
	if (quantity <= 0) return 0;
	return Math.max(0, Math.min(quantity, priorCredits + quantity - LAUNCH_PRICE.includedSmsCredits));
}

export function smsOverageCents(overageCredits: number): number {
	return overageCredits * LAUNCH_PRICE.messageCents;
}

/** Published customer schedule. Version changes require fresh customer acceptance. */
export const TELECOM_PRICE = {
 version: '2026-09-07-v1',
 brandCents: 450,
 campaignReviewCents: 1500,
 campaignMonthlyCents: 150,
 campaignInitialMonths: 3,
 numberMonthlyCents: 110
} as const;

/** Telnyx local DID is $1.00, SMS capability +$0.10. Refuse anything above that floor. */
export function isPassThroughLocalNumberPrice(input: {
	monthlyCents: number;
	upfrontCents: number;
}): boolean {
	const monthlyOk =
		input.monthlyCents === 100 || input.monthlyCents === TELECOM_PRICE.numberMonthlyCents;
	const upfrontOk =
		input.upfrontCents === 0 ||
		input.upfrontCents === 100 ||
		input.upfrontCents === TELECOM_PRICE.numberMonthlyCents ||
		input.upfrontCents === input.monthlyCents;
	return monthlyOk && upfrontOk;
}
