import { isPassThroughLocalNumberPrice } from '$lib/pricing';
import {
	NumberPurchaseError,
	type MessagingProvider,
	type NormalizedWebhookEvent,
	type NumberQuote,
	type RegistrationInput,
	type RegistrationStatus
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
			tags?: string[];
			parts?: number;
			cost?: { amount?: string; currency?: string };
			from?: { phone_number?: string };
			to?: { phone_number?: string; status?: string }[];
			errors?: { detail?: string }[];
		};
	};
};

type TelnyxEnvelope<T> = T & { data?: T };

type TelnyxAvailableNumber = {
	phone_number: string;
	cost_information?: { monthly_cost?: string; upfront_cost?: string; currency?: string };
};

type TelnyxNumberOrder = {
	id?: string;
	status?: string;
	phone_numbers?: { id?: string; phone_number?: string; status?: string }[];
};

function dollarsToCents(value: string | undefined): number | null {
	if (!value || !/^\d+(?:\.\d{1,6})?$/.test(value)) return null;
	const [whole, fraction = ''] = value.split('.');
	if (fraction.slice(2).replace(/0+$/, '')) return null;
	return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}

function quoteFromAvailable(row: TelnyxAvailableNumber): NumberQuote | null {
	if (!row.phone_number) return null;
	const monthlyCents = dollarsToCents(row.cost_information?.monthly_cost);
	const upfrontCents = dollarsToCents(row.cost_information?.upfront_cost);
	if (monthlyCents == null || upfrontCents == null) return null;
	if (row.cost_information?.currency && row.cost_information.currency !== 'USD') return null;
	return { e164: row.phone_number, monthlyCents, upfrontCents };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrap10dlc<T extends object>(payload: TelnyxEnvelope<T>): T {
	if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
		return payload.data;
	}
	return payload;
}

export class TelnyxMessagingProvider implements MessagingProvider {
	private apiKey(): string {
		const key = process.env.TELNYX_API_KEY;
		if (!key) throw new Error('TELNYX_API_KEY is not set');
		return key;
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await fetch(`${API}${path}`, {
			method,
			redirect: 'error',
			signal: AbortSignal.timeout(15_000),
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

	async searchNumbers(areaCode: string | null): Promise<NumberQuote[]> {
		const params = new URLSearchParams({
			'filter[country_code]': 'US',
			'filter[phone_number_type]': 'local',
			'filter[features][]': 'sms',
			'filter[limit]': '10'
		});
		params.append('filter[features][]', 'voice');
		if (areaCode) params.set('filter[national_destination_code]', areaCode);
		const result = await this.request<{ data: TelnyxAvailableNumber[] }>(
			'GET',
			`/available_phone_numbers?${params.toString()}`
		);
		return result.data.flatMap((row) => {
			const quote = quoteFromAvailable(row);
			return quote ? [quote] : [];
		});
	}

	async quoteNumber(e164: string): Promise<NumberQuote | null> {
		const params = new URLSearchParams({
			'filter[country_code]': 'US',
			'filter[phone_number_type]': 'local',
			'filter[phone_number]': e164
		});
		const result = await this.request<{ data: TelnyxAvailableNumber[] }>(
			'GET',
			`/available_phone_numbers?${params.toString()}`
		);
		const row = result.data.find((item) => item.phone_number === e164);
		return row ? quoteFromAvailable(row) : null;
	}

	async purchaseNumber(e164: string): Promise<{ providerNumberId: string }> {
		const quote = await this.quoteNumber(e164);
		if (!quote || !isPassThroughLocalNumberPrice(quote)) {
			throw new NumberPurchaseError('failed', 'That number is not available at the published $1.10 rate');
		}
		const profileId = process.env.TELNYX_MESSAGING_PROFILE_ID;
		const connectionId = process.env.TELNYX_VOICE_CONNECTION_ID;
		const result = await this.request<{
			data: TelnyxNumberOrder;
		}>('POST', '/number_orders', {
			phone_numbers: [{ phone_number: e164 }],
			...(profileId ? { messaging_profile_id: profileId } : {}),
			...(connectionId ? { connection_id: connectionId } : {})
		});
		return this.fulfillNumberOrder(e164, result.data);
	}

	private async fulfillNumberOrder(e164: string, order: TelnyxNumberOrder): Promise<{ providerNumberId: string }> {
		let current = order;
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const status = (current.status ?? '').toLowerCase();
			if (status === 'success' || status === 'complete') {
				const number = current.phone_numbers?.find((row) => row.phone_number === e164) ?? current.phone_numbers?.[0];
				const numberStatus = (number?.status ?? status).toLowerCase();
				if (numberStatus === 'failure' || numberStatus === 'failed') {
					throw new NumberPurchaseError('failed', 'That number is no longer available');
				}
				return { providerNumberId: number?.id ?? e164 };
			}
			if (status === 'failure' || status === 'failed') {
				throw new NumberPurchaseError('failed', 'That number is no longer available');
			}
			if (!current.id) break;
			await sleep(500);
			current = (await this.request<{ data: TelnyxNumberOrder }>('GET', `/number_orders/${encodeURIComponent(current.id)}`)).data;
		}
		throw new NumberPurchaseError('pending', 'Number order is still pending at the carrier');
	}

	async assignNumberToCampaign(input: { phoneNumber: string; campaignId: string }): Promise<void> {
		const res = await fetch(`${API}/10dlc/phone_number_campaigns`, {
			method: 'POST',
			redirect: 'error',
			signal: AbortSignal.timeout(15_000),
			headers: {
				authorization: `Bearer ${this.apiKey()}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ phoneNumber: input.phoneNumber, campaignId: input.campaignId })
		});
		if (res.ok) return;
		const text = await res.text().catch(() => '');
		if (res.status === 409 || (res.status === 422 && /already (assigned|linked|associated)/i.test(text))) {
			// A conflict can mean another campaign owns the number; verify the exact assignment.
			const assignment = unwrap10dlc(await this.request<TelnyxEnvelope<{
				phoneNumber?: string; campaignId?: string; assignmentStatus?: string;
			}>>('GET', `/10dlc/phone_number_campaigns/${encodeURIComponent(input.phoneNumber)}`));
			if (assignment.phoneNumber === input.phoneNumber && assignment.campaignId === input.campaignId
				&& assignment.assignmentStatus === 'ASSIGNED') return;
			throw new Error('telnyx campaign assignment could not be verified');
		}
		throw new Error(
			`telnyx POST /10dlc/phone_number_campaigns failed (${res.status})`
		);
	}

	async sendMessage(input: { from: string; to: string; body: string; clientMessageId?: string }): Promise<{
		providerMessageId: string;
	}> {
		const result = await this.request<{ data: { id: string } }>('POST', '/messages', {
			from: input.from,
			to: input.to,
			text: input.body,
			encoding: 'gsm7', type: 'SMS',
			...(input.clientMessageId ? {tags:[`kiso:${input.clientMessageId}`]} : {})
		});
		return { providerMessageId: result.data.id };
	}

	async submitRegistration(input: RegistrationInput): Promise<{
		brandId: string;
		campaignId: string;
		status: RegistrationStatus;
	}> {
		const brandBody: Record<string, unknown> = {
			entityType: input.ein ? 'PRIVATE_PROFIT' : 'SOLE_PROPRIETOR',
			displayName: input.legalName,
			companyName: input.legalName,
			phone: input.contactPhone,
			street: input.address,
			city: input.city,
			state: input.region,
			postalCode: input.postalCode,
			country: 'US',
			email: input.contactEmail,
			vertical: 'PROFESSIONAL',
			isReseller: false
		};
		if (input.ein) {
			brandBody.ein = input.ein;
			brandBody.einIssuingCountry = 'US';
		}
		if (input.website) brandBody.website = input.website;

		const brand = unwrap10dlc(
			await this.request<TelnyxEnvelope<{ brandId?: string; id?: string }>>(
				'POST',
				'/10dlc/brand',
				brandBody
			)
		);
		const brandId = brand.brandId ?? brand.id ?? '';
		if (!brandId) throw new Error('telnyx brand create did not return a brandId');

		const campaign = unwrap10dlc(
			await this.request<TelnyxEnvelope<{ campaignId?: string; id?: string }>>(
				'POST',
				'/10dlc/campaignBuilder',
				{
					brandId,
					usecase: 'LOW_VOLUME',
					description: input.useCase,
					sample1: input.sampleMessage,
					sample2:
						'Sorry we missed your call - how can we help today? Reply STOP to opt out.',
					messageFlow:
						'Customers opt in by providing their phone number to the business and consenting to be contacted. Reply STOP to opt out.',
					helpMessage:
						'Thanks for reaching out - reply here and we will get back to you. Reply STOP to opt out.',
					optinKeywords: 'START,YES',
					optoutKeywords: 'STOP,STOPALL,UNSUBSCRIBE,CANCEL,END,QUIT',
					helpKeywords: 'HELP',
					subscriberOptin: true,
					subscriberOptout: true,
					subscriberHelp: true,
					embeddedLink: false,
					embeddedPhone: false,
					numberPool: false,
					ageGated: false,
					directLending: false,
					affiliateMarketing: false
				}
			)
		);
		const campaignId = campaign.campaignId ?? campaign.id ?? '';
		if (!campaignId) throw new Error('telnyx campaign create did not return a campaignId');
		return { brandId, campaignId, status: 'submitted' };
	}

	async getRegistrationStatus(brandId: string, campaignId: string): Promise<RegistrationStatus> {
		const campaign = unwrap10dlc(
			await this.request<TelnyxEnvelope<{ campaignStatus?: string; status?: string }>>(
				'GET',
				`/10dlc/campaign/${encodeURIComponent(campaignId)}`
			)
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
				...(Number.isSafeInteger(inner.parts) && inner.parts! > 0 ? { parts: inner.parts } : {}),
				...(inner.cost?.currency === 'USD' && /^\d+(?:\.\d{1,6})?$/.test(inner.cost.amount ?? '') ? { costUsd: inner.cost.amount } : {}),
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
				...(inner.tags?.find(tag=>/^kiso:[0-9a-f-]{36}$/.test(tag)) ? {clientMessageId:inner.tags.find(tag=>/^kiso:[0-9a-f-]{36}$/.test(tag))!.slice(5)} : {}),
				eventId: data.id,
				providerMessageId: inner.id,
				...(Number.isSafeInteger(inner.parts) && inner.parts! > 0 ? { parts: inner.parts } : {}),
				...(inner.cost?.currency === 'USD' && /^\d+(?:\.\d{1,6})?$/.test(inner.cost.amount ?? '') ? { costUsd: inner.cost.amount } : {}),
				from,
				status: failed ? 'failed' : data.event_type === 'message.finalized' ? 'delivered' : 'sent',
				error: failed ? (inner.errors?.[0]?.detail ?? carrierStatus ?? 'delivery failed') : null
			};
		}

		return null;
	}
}
