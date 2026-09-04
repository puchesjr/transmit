import { isIP } from 'node:net';
import { refuseFakeInProduction } from './production';

export type OutboundWebhookRequest = {
	url: string;
	body: string;
	headers: Record<string, string>;
};

export interface OutboundWebhookProvider {
	readonly name: 'fetch' | 'fake';
	deliver(request: OutboundWebhookRequest): Promise<{ status: number }>;
}

export function isPrivateNetworkAddress(value: string): boolean {
	const address = value.toLowerCase().replace(/^\[|\]$/g, '');
	if (isIP(address) === 4) {
		const parts = address.split('.').map(Number);
		return (
			parts[0] === 0 ||
			parts[0] === 10 ||
			parts[0] === 127 ||
			(parts[0] === 169 && parts[1] === 254) ||
			(parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
			(parts[0] === 192 && parts[1] === 168) ||
			parts[0] >= 224
		);
	}
	if (isIP(address) === 6) {
		if (address === '::' || address === '::1') return true;
		if (address.startsWith('fc') || address.startsWith('fd') || address.startsWith('ff')) return true;
		if (/^fe[89ab]/.test(address)) return true;
		if (address.startsWith('::ffff:')) {
			return isPrivateNetworkAddress(address.slice('::ffff:'.length));
		}
	}
	return false;
}

let provider: OutboundWebhookProvider | undefined;

export async function getOutboundWebhookProvider(): Promise<OutboundWebhookProvider> {
	if (!provider) {
		if (
			process.env.OUTBOUND_WEBHOOK_PROVIDER === 'fake' ||
			process.env.NODE_ENV === 'test'
		) {
			refuseFakeInProduction('outbound webhook', 'OUTBOUND_WEBHOOK_PROVIDER to fetch');
			const { FakeOutboundWebhookProvider } = await import('./fake-outbound-webhook');
			provider = new FakeOutboundWebhookProvider();
		} else {
			const { FetchOutboundWebhookProvider } = await import('./fetch-outbound-webhook');
			provider = new FetchOutboundWebhookProvider();
		}
	}
	return provider;
}

export function setOutboundWebhookProvider(
	override: OutboundWebhookProvider | undefined
): void {
	provider = override;
}
