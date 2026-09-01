import { lookup } from 'node:dns/promises';
import type {
	OutboundWebhookProvider,
	OutboundWebhookRequest
} from './outbound-webhook';
import { isPrivateNetworkAddress } from './outbound-webhook';

export class FetchOutboundWebhookProvider implements OutboundWebhookProvider {
	readonly name = 'fetch' as const;

	async deliver(request: OutboundWebhookRequest): Promise<{ status: number }> {
		const url = new URL(request.url);
		const addresses = await lookup(url.hostname, { all: true, verbatim: true });
		if (addresses.length === 0 || addresses.some(({ address }) => isPrivateNetworkAddress(address))) {
			throw new Error('webhook endpoint resolved to a private or reserved network');
		}
		const response = await fetch(request.url, {
			method: 'POST',
			headers: request.headers,
			body: request.body,
			redirect: 'error',
			signal: AbortSignal.timeout(10_000)
		});
		return { status: response.status };
	}
}
