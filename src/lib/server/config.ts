/**
 * What production needs before it is allowed to serve a request. Checked once
 * at boot from hooks.server.ts; a missing value stops the process with the
 * list of problems, which is the loud failure the provider fallbacks used to
 * paper over.
 */
const REQUIRED_IN_PRODUCTION: { name: string; why: string }[] = [
	{ name: 'DATABASE_URL', why: 'Postgres connection' },
	{ name: 'PUBLIC_SITE_URL', why: 'canonical https origin for links and emails' },
	{ name: 'ORIGIN', why: 'adapter-node needs the public origin behind a proxy' },
	{ name: 'STRIPE_SECRET_KEY', why: 'billing' },
	{ name: 'STRIPE_WEBHOOK_SECRET', why: 'billing webhook verification' },
	{ name: 'STRIPE_LOCATION_PRICE_ID', why: 'the per-location subscription price' },
	{ name: 'STRIPE_MESSAGE_PRICE_ID', why: 'the metered message price' },
	{ name: 'STRIPE_MESSAGE_METER_EVENT_NAME', why: 'the meter usage is reported to' },
	{ name: 'TELNYX_API_KEY', why: 'SMS and voice' },
	{ name: 'TELNYX_PUBLIC_KEY', why: 'Telnyx webhook verification' },
	{ name: 'TELNYX_MESSAGING_PROFILE_ID', why: 'number provisioning' },
	{ name: 'TELNYX_VOICE_CONNECTION_ID', why: 'missed-call textback' },
	{ name: 'TRANSMIT_API_KEY', why: 'transactional email (password resets)' },
	{ name: 'EMAIL_FROM', why: 'the approved sender password resets come from' }
];

const FAKE_SELECTORS = [
	'BILLING_PROVIDER',
	'MESSAGING_PROVIDER',
	'VOICE_PROVIDER',
	'EMAIL_PROVIDER',
	'OUTBOUND_WEBHOOK_PROVIDER'
];

export function productionConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
	const problems: string[] = [];
	for (const { name, why } of REQUIRED_IN_PRODUCTION) {
		if (!env[name]?.trim()) problems.push(`${name} is not set (${why})`);
	}
	if (env.PUBLIC_SITE_URL && !env.PUBLIC_SITE_URL.startsWith('https://')) {
		problems.push('PUBLIC_SITE_URL must start with https://');
	}
	if (env.COOKIE_SECURE === 'false') {
		problems.push('COOKIE_SECURE=false is not allowed in production');
	}
	for (const selector of FAKE_SELECTORS) {
		if (env[selector]?.trim() === 'fake') problems.push(`${selector}=fake is not allowed in production`);
	}
	if (env.XAI_API_KEY && env.AI_PROVIDER !== 'anthropic' && env.AI_PROVIDER !== 'fake' && env.XAI_ZDR_CONFIRMED !== 'true') {
		problems.push('XAI_ZDR_CONFIRMED must be true before production AI traffic (or select another AI_PROVIDER)');
	}
	return problems;
}

export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
	if (env.NODE_ENV !== 'production') return;
	const problems = productionConfigProblems(env);
	if (problems.length === 0) return;
	throw new Error(`Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
}
