import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import type {
	OutboundWebhookProvider,
	OutboundWebhookRequest
} from './outbound-webhook';
import { isPrivateNetworkAddress } from './outbound-webhook';

export class FetchOutboundWebhookProvider implements OutboundWebhookProvider {
	readonly name = 'fetch' as const;

	async deliver(request: OutboundWebhookRequest): Promise<{ status: number }> {
		const url = new URL(request.url);
		if (url.protocol !== 'https:') {
			throw new Error('webhook endpoint must be HTTPS');
		}
		const addresses = await lookup(url.hostname, { all: true, verbatim: true });
		if (addresses.length === 0 || addresses.some(({ address }) => isPrivateNetworkAddress(address))) {
			throw new Error('webhook endpoint resolved to a private or reserved network');
		}
		const target = addresses[0];
		const body = request.body;
		return new Promise((resolve, reject) => {
			const req = httpsRequest(
				{
					host: target.address,
					family: target.family,
					port: url.port ? Number(url.port) : 443,
					path: `${url.pathname}${url.search}`,
					method: 'POST',
					servername: url.hostname,
					headers: {
						...request.headers,
						host: url.host,
						'content-length': String(Buffer.byteLength(body))
					},
					signal: AbortSignal.timeout(10_000)
				},
				(res: IncomingMessage) => {
					res.resume();
					const status = res.statusCode ?? 0;
					if (status >= 300 && status < 400) {
						reject(new Error('webhook endpoint redirected'));
						return;
					}
					resolve({ status });
				}
			);
			req.on('timeout', () => req.destroy(new Error('webhook timeout')));
			req.on('error', reject);
			req.write(body);
			req.end();
		});
	}
}
