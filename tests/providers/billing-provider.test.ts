import { afterEach, expect, it, vi } from 'vitest';
import { getAiProvider, setAiProvider } from '$lib/server/providers/ai';
import { getBillingProvider, liveCarrierConfigured, setBillingProvider } from '$lib/server/providers/billing';
import { getMessagingProvider, setMessagingProvider } from '$lib/server/providers/messaging';
import { getVoiceProvider, setVoiceProvider } from '$lib/server/providers/voice';

afterEach(() => {
	setBillingProvider(undefined);
	setMessagingProvider(undefined);
	setVoiceProvider(undefined);
	setAiProvider(undefined);
	vi.unstubAllEnvs();
});

it('refuses to select the fake billing provider in production', async () => {
	vi.stubEnv('NODE_ENV', 'production');
	vi.stubEnv('BILLING_PROVIDER', 'fake');
	await expect(getBillingProvider()).rejects.toThrow(
		'The fake billing provider cannot be used in production'
	);
});

it('refuses fake messaging, voice, and AI providers in production', async () => {
	vi.stubEnv('NODE_ENV', 'production');
	vi.stubEnv('MESSAGING_PROVIDER', 'fake');
	vi.stubEnv('VOICE_PROVIDER', 'fake');
	vi.stubEnv('AI_PROVIDER', 'fake');
	await expect(getMessagingProvider()).rejects.toThrow(
		'The fake messaging provider cannot be used in production'
	);
	await expect(getVoiceProvider()).rejects.toThrow(
		'The fake voice provider cannot be used in production'
	);
	await expect(getAiProvider()).rejects.toThrow('The fake AI provider cannot be used in production');
});

it('treats Telnyx as live only when messaging or voice is not forced fake', () => {
	vi.stubEnv('TELNYX_API_KEY', 'KEY');
	vi.stubEnv('MESSAGING_PROVIDER', 'fake');
	vi.stubEnv('VOICE_PROVIDER', 'fake');
	expect(liveCarrierConfigured()).toBe(false);
	vi.stubEnv('MESSAGING_PROVIDER', 'telnyx');
	expect(liveCarrierConfigured()).toBe(true);
});
