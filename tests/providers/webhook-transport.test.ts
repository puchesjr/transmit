import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { FetchOutboundWebhookProvider } from '$lib/server/providers/fetch-outbound-webhook';
import { isPrivateNetworkAddress } from '$lib/server/providers/outbound-webhook';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it('pins the public address while retaining TLS hostname and the authority port', async () => {
	vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
	let options: Record<string, any> = {};
	vi.mocked(request).mockImplementation(((input: Record<string, any>, callback: Function) => {
		options = input;
		const req = Object.assign(new EventEmitter(), {
			write: vi.fn(), destroy: vi.fn(),
			end: () => callback({ statusCode: 204, resume: vi.fn() })
		});
		return req;
	}) as never);
	await expect(new FetchOutboundWebhookProvider().deliver({ url: 'https://example.com:8443/events?a=1', headers: {}, body: '{}' })).resolves.toEqual({ status: 204 });
	expect(options.host).toBe('8.8.8.8');
	expect(options.servername).toBe('example.com');
	expect(options.headers.host).toBe('example.com:8443');
	expect(options.signal).toBeInstanceOf(AbortSignal);
});

it('rejects private DNS answers before connecting', async () => {
	vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
	await expect(new FetchOutboundWebhookProvider().deliver({ url: 'https://example.com', headers: {}, body: '{}' })).rejects.toThrow(/private/);
	expect(request).not.toHaveBeenCalled();
	expect(isPrivateNetworkAddress('::ffff:7f00:1')).toBe(true);
	expect(isPrivateNetworkAddress('::ffff:127.0.0.1')).toBe(true);
});
