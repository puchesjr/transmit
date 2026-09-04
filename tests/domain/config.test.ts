import { describe, expect, test } from 'vitest';
import { assertProductionConfig, productionConfigProblems } from '$lib/server/config';

const complete: NodeJS.ProcessEnv = {
	NODE_ENV: 'production',
	DATABASE_URL: 'postgres://x',
	PUBLIC_SITE_URL: 'https://kisocrm.com',
	ORIGIN: 'https://kisocrm.com',
	STRIPE_SECRET_KEY: 'sk_live_x',
	STRIPE_WEBHOOK_SECRET: 'whsec_x',
	STRIPE_LOCATION_PRICE_ID: 'price_l',
	STRIPE_MESSAGE_PRICE_ID: 'price_m',
	STRIPE_MESSAGE_METER_EVENT_NAME: 'messages',
	TELNYX_API_KEY: 'KEY',
	TELNYX_PUBLIC_KEY: 'PUB',
	TELNYX_MESSAGING_PROFILE_ID: 'mp',
	TELNYX_VOICE_CONNECTION_ID: 'vc',
	TRANSMIT_API_KEY: 'tr_v2_x',
	EMAIL_FROM: 'Kiso CRM <hello@kisocrm.com>'
};

describe('production config', () => {
	test('a complete environment has no problems', () => {
		expect(productionConfigProblems(complete)).toEqual([]);
		expect(() => assertProductionConfig(complete)).not.toThrow();
	});

	test('names every missing variable at once, not one per restart', () => {
		const problems = productionConfigProblems({ NODE_ENV: 'production' });
		expect(problems.length).toBeGreaterThanOrEqual(14);
		expect(problems.join('\n')).toMatch(/STRIPE_SECRET_KEY/);
		expect(problems.join('\n')).toMatch(/TELNYX_API_KEY/);
		expect(problems.join('\n')).toMatch(/TRANSMIT_API_KEY/);
	});

	test('refuses insecure cookies, http origins, fakes, and unconfirmed xAI retention', () => {
		const problems = productionConfigProblems({
			...complete,
			PUBLIC_SITE_URL: 'http://kisocrm.com',
			COOKIE_SECURE: 'false',
			BILLING_PROVIDER: 'fake',
			XAI_API_KEY: 'xai'
		});
		expect(problems).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/https/),
				expect.stringMatching(/COOKIE_SECURE/),
				expect.stringMatching(/BILLING_PROVIDER=fake/),
				expect.stringMatching(/XAI_ZDR_CONFIRMED/)
			])
		);
	});

	test('does nothing outside production', () => {
		expect(() => assertProductionConfig({ NODE_ENV: 'development' })).not.toThrow();
		expect(() => assertProductionConfig({ NODE_ENV: 'production' })).toThrow(/Refusing to start/);
	});
});
