import { afterEach, expect, it, vi } from 'vitest';
import { verifyTelnyxWebhook } from '$lib/server/providers/telnyx-webhook';

afterEach(() => {
	vi.unstubAllEnvs();
});

it('rejects a stale Telnyx webhook timestamp before signature verification', () => {
	vi.stubEnv('TELNYX_PUBLIC_KEY', Buffer.alloc(32).toString('base64'));
	expect(verifyTelnyxWebhook('{}', 'c2ln', '0')).toBe(false);
	expect(verifyTelnyxWebhook('{}', 'c2ln', String(Math.floor(Date.now() / 1000) - 10 * 60))).toBe(
		false
	);
});
