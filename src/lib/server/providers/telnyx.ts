import type {
	MessagingProvider,
	NormalizedWebhookEvent,
	RegistrationInput,
	RegistrationStatus
} from './messaging';
import { verifyTelnyxWebhook } from './telnyx-webhook';

const API = 'https://api.telnyx.com/v2';

type TelnyxWebhook = {
	data?: {
		id?: string;
		event_type?: string;
		payload?: {
			id?: string;
			text?: string;
			from?: { phone_number?: string };
			to?: { phone_number?: string; status?: string }[];
			errors?: { detail?: string }[];
		};
	};
};

export class TelnyxMessagingProvider implements MessagingProvider {
	private apiKey(): string {
		const key = process.env.TELNYX_API_KEY;
		if (!key) throw new Error('TELNYX_API_KEY is not set');
		return key;
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await fetch(`${API}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${this.apiKey()}`,
				'content-type': 'application/json'
			},
			body: body == null ? undefined : JSON.stringify(body)
		});
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`telnyx ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
		}
		return (await res.json()) as T;
	}

	async searchNumbers(areaCode: string | null): Promise<{ e164: string }[]> {
		const params = new URLSearchParams({
			'filter[country_code]': 'US',
			'filter[features][]': 'sms',
			'filter[limit]': '10'
		});
		params.append('filter[features][]', 'voice');
		if (areaCode) params.set('filter[national_destination_code]', areaCode);
		const result = await this.request<{ data: { phone_number: string }[] }>(
			'GET',
			`/available_phone_numbers?${params.toString()}`
		);
		return result.data.map((row) => ({ e164: row.phone_number }));
	}

	async purchaseNumber(e164: string): Promise<{ providerNumberId: string }> {
		const profileId = process.env.TELNYX_MESSAGING_PROFILE_ID;
		const connectionId = process.env.TELNYX_VOICE_CONNECTION_ID;
		const result = await this.request<{
			data: { phone_numbers: { id?: string; phone_number: string }[] };
		}>('POST', '/number_orders', {
			phone_numbers: [{ phone_number: e164 }],
			...(profileId ? { messaging_profile_id: profileId } : {}),
			...(connectionId ? { connection_id: connectionId } : {})
		});
		return { providerNumberId: result.data.phone_numbers[0]?.id ?? e164 };
	}

	async sendMessage(input: { from: string; to: string; body: string }): Promise<{
		providerMessageId: string;
	}> {
		const result = await this.request<{ data: { id: string } }>('POST', '/messages', {
			from: input.from,
			to: input.to,
			text: input.body
		});
		return { providerMessageId: result.data.id };
	}

	async submitRegistration(input: RegistrationInput): Promise<{
		brandId: string;
		campaignId: string;
		status: RegistrationStatus;
	}> {
		const brand = await this.request<{ brandId?: string; id?: string }>('POST', '/10dlc/brand', {
			entityType: input.ein ? 'PRIVATE_PROFIT' : 'SOLE_PROPRIETOR',
			displayName: input.legalName,
			companyName: input.legalName,
			ein: input.ein ?? undefined,
			website: input.website ?? undefined,
			email: input.contactEmail,
			country: 'US',
			vertical: 'PROFESSIONAL',
			street: input.address,
			brandRelationship: 'BASIC_ACCOUNT'
		});
		const brandId = brand.brandId ?? brand.id ?? '';
		const campaign = await this.request<{ campaignId?: string; id?: string }>(
			'POST',
			'/10dlc/campaignBuilder',
			{
				brandId,
				usecase: 'LOW_VOLUME',
				description: input.useCase,
				sample1: input.sampleMessage,
				messageFlow:
					'Customers opt in by providing their phone number to the business and consenting to be contacted. Reply STOP to opt out.',
				subscriberOptin: true,
				subscriberOptout: true,
				subscriberHelp: true
			}
		);
		return {
			brandId,
			campaignId: campaign.campaignId ?? campaign.id ?? '',
			status: 'submitted'
		};
	}

	async getRegistrationStatus(brandId: string, campaignId: string): Promise<RegistrationStatus> {
		const campaign = await this.request<{ campaignStatus?: string; status?: string }>(
			'GET',
			`/10dlc/campaign/${encodeURIComponent(campaignId)}`
		);
		const status = (campaign.campaignStatus ?? campaign.status ?? '').toUpperCase();
		if (status === 'ACTIVE' || status === 'APPROVED') return 'approved';
		if (status.includes('REJECT') || status.includes('FAIL')) return 'rejected';
		void brandId;
		return 'submitted';
	}

	verifyWebhook(rawBody: string, signature: string | null, timestamp: string | null): boolean {
		return verifyTelnyxWebhook(rawBody, signature, timestamp);
	}

	parseWebhook(payload: unknown): NormalizedWebhookEvent | null {
		const event = payload as TelnyxWebhook;
		const data = event?.data;
		const inner = data?.payload;
		if (!data?.id || !data.event_type || !inner?.id) return null;

		if (data.event_type === 'message.received') {
			const from = inner.from?.phone_number;
			const to = inner.to?.[0]?.phone_number;
			if (!from || !to) return null;
			return {
				type: 'inbound',
				eventId: data.id,
				providerMessageId: inner.id,
				from,
				to,
				text: inner.text ?? ''
			};
		}

		if (data.event_type === 'message.sent' || data.event_type === 'message.finalized') {
			const from = inner.from?.phone_number;
			if (!from) return null;
			const carrierStatus = inner.to?.[0]?.status ?? '';
			const failed =
				carrierStatus === 'delivery_failed' ||
				carrierStatus === 'sending_failed' ||
				(data.event_type === 'message.finalized' && carrierStatus !== 'delivered');
			return {
				type: 'status',
				eventId: data.id,
				providerMessageId: inner.id,
				from,
				status: failed ? 'failed' : data.event_type === 'message.finalized' ? 'delivered' : 'sent',
				error: failed ? (inner.errors?.[0]?.detail ?? carrierStatus ?? 'delivery failed') : null
			};
		}

		return null;
	}
}
