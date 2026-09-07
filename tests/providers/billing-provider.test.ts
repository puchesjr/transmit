import { afterEach, expect, it, vi } from 'vitest';
import { getBillingProvider, liveCarrierConfigured, setBillingProvider } from '$lib/server/providers/billing';

afterEach(() => {
	setBillingProvider(undefined);
	vi.unstubAllEnvs();
});

it('refuses to select the fake billing provider in production', async () => {
	vi.stubEnv('NODE_ENV', 'production');
	vi.stubEnv('BILLING_PROVIDER', 'fake');
	await expect(getBillingProvider()).rejects.toThrow(
		'The fake billing provider cannot be used in production'
	);
});

it('treats Telnyx as live only when messaging or voice is not forced fake', () => {
	vi.stubEnv('TELNYX_API_KEY', 'KEY');
	vi.stubEnv('MESSAGING_PROVIDER', 'fake');
	vi.stubEnv('VOICE_PROVIDER', 'fake');
	expect(liveCarrierConfigured()).toBe(false);
	vi.stubEnv('MESSAGING_PROVIDER', 'telnyx');
	expect(liveCarrierConfigured()).toBe(true);
});
