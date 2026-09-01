import type {
	OutboundWebhookProvider,
	OutboundWebhookRequest
} from './outbound-webhook';

export class FakeOutboundWebhookProvider implements OutboundWebhookProvider {
	readonly name = 'fake' as const;
	deliveries: OutboundWebhookRequest[] = [];
	responses: number[] = [];

	async deliver(request: OutboundWebhookRequest): Promise<{ status: number }> {
		this.deliveries.push(request);
		return { status: this.responses.shift() ?? 204 };
	}
}
