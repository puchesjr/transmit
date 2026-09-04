import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { getAiProvider, setAiProvider } from '$lib/server/providers/ai';
import { getBillingProvider, setBillingProvider } from '$lib/server/providers/billing';
import { getEmailProvider, setEmailProvider } from '$lib/server/providers/email';
import { getMessagingProvider, setMessagingProvider } from '$lib/server/providers/messaging';
import { getOutboundWebhookProvider, setOutboundWebhookProvider } from '$lib/server/providers/outbound-webhook';
import { getVoiceProvider, setVoiceProvider } from '$lib/server/providers/voice';

/**
 * The bug these pin: a missing key used to select the fake silently. In
 * production that is a subscription that never bills and a text that never
 * leaves. Now it stops the boot.
 */
const VARS = [
	'NODE_ENV',
	'BILLING_PROVIDER',
	'STRIPE_SECRET_KEY',
	'MESSAGING_PROVIDER',
	'VOICE_PROVIDER',
	'TELNYX_API_KEY',
	'EMAIL_PROVIDER',
	'TRANSMIT_API_KEY',
	'EMAIL_FROM',
	'AI_PROVIDER',
	'XAI_API_KEY',
	'ANTHROPIC_API_KEY',
	'OUTBOUND_WEBHOOK_PROVIDER'
] as const;
const saved: Partial<Record<(typeof VARS)[number], string | undefined>> = {};

function reset() {
	setBillingProvider(undefined);
	setMessagingProvider(undefined);
	setVoiceProvider(undefined);
	setEmailProvider(undefined);
	setAiProvider(undefined);
	setOutboundWebhookProvider(undefined);
}

beforeEach(() => {
	for (const name of VARS) {
		saved[name] = process.env[name];
		delete process.env[name];
	}
	process.env.NODE_ENV = 'production';
	reset();
});

afterEach(() => {
	for (const name of VARS) {
		if (saved[name] === undefined) delete process.env[name];
		else process.env[name] = saved[name];
	}
	reset();
});

describe('in production, a missing key stops the boot instead of selecting a fake', () => {
	test('billing without STRIPE_SECRET_KEY', async () => {
		await expect(getBillingProvider()).rejects.toThrow(/production.*STRIPE_SECRET_KEY/);
	});
	test('billing forced to fake', async () => {
		process.env.STRIPE_SECRET_KEY = 'sk_test_x';
		process.env.BILLING_PROVIDER = 'fake';
		await expect(getBillingProvider()).rejects.toThrow(/production/);
	});
	test('messaging without TELNYX_API_KEY', async () => {
		await expect(getMessagingProvider()).rejects.toThrow(/production.*TELNYX_API_KEY/);
	});
	test('voice forced to fake', async () => {
		process.env.TELNYX_API_KEY = 'KEY';
		process.env.VOICE_PROVIDER = 'fake';
		await expect(getVoiceProvider()).rejects.toThrow(/production/);
	});
	test('email without TRANSMIT_API_KEY', async () => {
		await expect(getEmailProvider()).rejects.toThrow(/production.*TRANSMIT_API_KEY/);
	});
	test('outbound webhooks forced to fake', async () => {
		process.env.OUTBOUND_WEBHOOK_PROVIDER = 'fake';
		await expect(getOutboundWebhookProvider()).rejects.toThrow(/production/);
	});
	test('AI without a key and without an explicit opt-out', async () => {
		await expect(getAiProvider()).rejects.toThrow(/AI_PROVIDER=fake/);
	});
	test('AI may be switched off on purpose', async () => {
		process.env.AI_PROVIDER = 'fake';
		await expect(getAiProvider()).resolves.toMatchObject({ name: 'fake' });
	});
});

describe('outside production the fakes still select themselves', () => {
	test('development with no keys', async () => {
		process.env.NODE_ENV = 'development';
		await expect(getBillingProvider()).resolves.toMatchObject({ mode: 'demo' });
		await expect(getEmailProvider()).resolves.toMatchObject({ name: 'fake' });
		await expect(getAiProvider()).resolves.toMatchObject({ name: 'fake' });
	});
});
