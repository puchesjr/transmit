import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TransmitEmailProvider } from '$lib/server/providers/transmit-email';

const saved = { key: process.env.TRANSMIT_API_KEY, from: process.env.EMAIL_FROM, base: process.env.TRANSMIT_API_BASE_URL };

beforeEach(() => {
	process.env.TRANSMIT_API_KEY = 'tr_v2_test';
	process.env.EMAIL_FROM = 'Kiso CRM <hello@kisocrm.com>';
	delete process.env.TRANSMIT_API_BASE_URL;
});

afterEach(() => {
	vi.unstubAllGlobals();
	if (saved.key === undefined) delete process.env.TRANSMIT_API_KEY; else process.env.TRANSMIT_API_KEY = saved.key;
	if (saved.from === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = saved.from;
	if (saved.base === undefined) delete process.env.TRANSMIT_API_BASE_URL; else process.env.TRANSMIT_API_BASE_URL = saved.base;
});

describe('the transmit.dev email adapter', () => {
	test('posts the Resend shape to /emails with the bearer key and returns the id', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'msg_01' }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const provider = new TransmitEmailProvider();
		const result = await provider.send({ to: 'owner@example.com', subject: 'Reset', text: 'link' });
		expect(result).toEqual({ providerMessageId: 'msg_01' });
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://api.transmit.dev/emails');
		expect((init.headers as Record<string, string>).authorization).toBe('Bearer tr_v2_test');
		expect(JSON.parse(String(init.body))).toEqual({
			from: 'Kiso CRM <hello@kisocrm.com>',
			to: 'owner@example.com',
			subject: 'Reset',
			text: 'link'
		});
	});

	test('surfaces a refusal instead of pretending the mail went', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"sender not approved"}', { status: 422 })));
		const provider = new TransmitEmailProvider();
		await expect(provider.send({ to: 'x@example.com', subject: 's', text: 't' })).rejects.toThrow(/422/);
	});

	test('refuses to construct without a key or a from address', () => {
		delete process.env.EMAIL_FROM;
		expect(() => new TransmitEmailProvider()).toThrow(/EMAIL_FROM/);
		delete process.env.TRANSMIT_API_KEY;
		expect(() => new TransmitEmailProvider()).toThrow(/TRANSMIT_API_KEY/);
	});
});
