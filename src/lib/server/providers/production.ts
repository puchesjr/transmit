/**
 * The fakes prove the workflow, not carrier delivery or payment settlement.
 * In production a missing key has to stop the boot, not quietly run a free
 * demo: with the old selectors, a typo in STRIPE_SECRET_KEY meant every
 * customer got a subscription that never billed, and a missing TELNYX_API_KEY
 * meant every text reported as sent and went nowhere.
 */
export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.NODE_ENV === 'production';
}

export function refuseFakeInProduction(provider: string, requirement: string): void {
	if (!isProduction()) return;
	throw new Error(
		`The fake ${provider} provider cannot be used in production. Set ${requirement}.`
	);
}
