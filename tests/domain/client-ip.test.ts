import { expect, it } from 'vitest';
import { clientIp } from '$lib/server/http';

it('uses the configured adapter address and never falls back to a spoofable header', () => {
	const request = new Request('https://kisocrm.test', { headers: { 'x-forwarded-for': '198.51.100.99' } });
	expect(clientIp({ request, getClientAddress: () => '203.0.113.1' })).toBe('203.0.113.1');
	expect(clientIp({ request, getClientAddress: () => { throw new Error('missing proxy configuration'); } })).toBeNull();
});
