import type { SchedulerProvider, SchedulerSlot } from './scheduler';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Scheduler returned an invalid response');
	}
	return value as JsonObject;
}

function slot(value: unknown): SchedulerSlot {
	const raw = object(value);
	if (
		typeof raw.id !== 'string' ||
		typeof raw.startsAt !== 'string' ||
		typeof raw.endsAt !== 'string' ||
		typeof raw.timezone !== 'string' ||
		!Number.isFinite(Date.parse(raw.startsAt)) ||
		!Number.isFinite(Date.parse(raw.endsAt)) ||
		Date.parse(raw.endsAt) <= Date.parse(raw.startsAt)
	) {
		throw new Error('Scheduler returned an invalid slot');
	}
	return {
		id: raw.id,
		startsAt: raw.startsAt,
		endsAt: raw.endsAt,
		timezone: raw.timezone
	};
}

export class DesignPartnerSchedulerProvider implements SchedulerProvider {
	readonly name = 'design_partner' as const;
	private readonly baseUrl: string;
	private readonly apiKey: string;

	constructor() {
		this.baseUrl = (process.env.SCHEDULER_API_BASE_URL ?? '').replace(/\/$/, '');
		this.apiKey = process.env.SCHEDULER_API_KEY ?? '';
		if (!this.baseUrl || !this.apiKey) {
			throw new Error('Design-partner scheduler credentials are not configured');
		}
		const url = new URL(this.baseUrl);
		if (url.protocol !== 'https:') throw new Error('SCHEDULER_API_BASE_URL must use HTTPS');
	}

	private async request(path: string, body: JsonObject, idempotencyKey?: string): Promise<JsonObject> {
		const response = await fetch(`${this.baseUrl}${path}`, {
			method: 'POST',
			redirect: 'error',
			headers: {
				accept: 'application/json',
				'content-type': 'application/json',
				authorization: `Bearer ${this.apiKey}`,
				...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {})
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(15_000)
		});
		if (!response.ok) throw new Error(`Scheduler request failed (${response.status})`);
		const text = await response.text();
		if (!text.trim()) return {};
		try {
			return object(JSON.parse(text));
		} catch {
			throw new Error('Scheduler returned an invalid response');
		}
	}

	async getAvailability(input: Parameters<SchedulerProvider['getAvailability']>[0]) {
		const result = await this.request('/availability', {
			locationId: input.providerLocationId,
			serviceId: input.providerServiceId,
			serviceName: input.serviceName,
			durationMinutes: input.durationMinutes,
			timezone: input.timezone,
			windowStart: input.windowStart.toISOString(),
			windowEnd: input.windowEnd.toISOString()
		});
		if (!Array.isArray(result.slots)) throw new Error('Scheduler returned no slots array');
		return result.slots.map(slot).slice(0, 20);
	}

	async hold(input: Parameters<SchedulerProvider['hold']>[0]) {
		const result = await this.request(
			'/holds',
			{
				locationId: input.providerLocationId,
				serviceId: input.providerServiceId,
				slot: input.slot,
				customer: input.customer
			},
			input.idempotencyKey
		);
		if (typeof result.holdId !== 'string' || !result.holdId.trim() || result.holdId.length > 500 || typeof result.expiresAt !== 'string') {
			throw new Error('Scheduler returned an invalid hold');
		}
		return { holdId: result.holdId, slot: slot(result.slot), expiresAt: result.expiresAt };
	}

	async book(input: Parameters<SchedulerProvider['book']>[0]) {
		const result = await this.request(
			'/bookings',
			{ holdId: input.holdId, customer: input.customer, notes: input.notes },
			input.idempotencyKey
		);
		if (typeof result.bookingId !== 'string' || !result.bookingId.trim() || result.bookingId.length > 500) {
			throw new Error('Scheduler returned an invalid booking');
		}
		return { bookingId: result.bookingId, slot: slot(result.slot) };
	}

	async cancel(input: Parameters<SchedulerProvider['cancel']>[0]): Promise<void> {
		await this.request(
			'/cancellations',
			{
				bookingId: input.bookingId ?? null,
				holdId: input.holdId ?? null,
				reason: input.reason
			},
			input.idempotencyKey
		);
	}
}
