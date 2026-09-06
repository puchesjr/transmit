import type {
	SchedulerCustomer,
	SchedulerProvider,
	SchedulerSlot
} from './scheduler';

type Hold = { id: string; slot: SchedulerSlot; expiresAt: string };

function localParts(value: Date, timezone: string): { year: number; month: number; day: number } {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(value);
	return {
		year: Number(parts.find((part) => part.type === 'year')?.value),
		month: Number(parts.find((part) => part.type === 'month')?.value),
		day: Number(parts.find((part) => part.type === 'day')?.value)
	};
}

function zonedTime(
	year: number,
	month: number,
	day: number,
	hour: number,
	timezone: string
): Date {
	const target = Date.UTC(year, month - 1, day, hour);
	let guess = target;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone: timezone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).formatToParts(new Date(guess));
		const shown = Date.UTC(
			Number(parts.find((part) => part.type === 'year')?.value),
			Number(parts.find((part) => part.type === 'month')?.value) - 1,
			Number(parts.find((part) => part.type === 'day')?.value),
			Number(parts.find((part) => part.type === 'hour')?.value) % 24,
			Number(parts.find((part) => part.type === 'minute')?.value)
		);
		guess += target - shown;
	}
	return new Date(guess);
}

export class FakeSchedulerProvider implements SchedulerProvider {
	readonly name = 'fake' as const;
	readonly holds = new Map<string, Hold>();
	readonly bookings = new Map<string, { id: string; slot: SchedulerSlot }>();
	readonly cancelled = new Set<string>();
	private readonly consumedHolds = new Set<string>();

	private slotIsReserved(slot: SchedulerSlot): boolean {
		const sameSlot = (candidate: SchedulerSlot) =>
			candidate.id === slot.id &&
			candidate.startsAt === slot.startsAt &&
			candidate.endsAt === slot.endsAt &&
			candidate.timezone === slot.timezone;
		const held = [...this.holds.values()].some(
			(hold) =>
				!this.cancelled.has(hold.id) &&
				!this.consumedHolds.has(hold.id) &&
				Date.parse(hold.expiresAt) > Date.now() &&
				sameSlot(hold.slot)
		);
		const booked = [...this.bookings.values()].some(
			(booking) => !this.cancelled.has(booking.id) && sameSlot(booking.slot)
		);
		return held || booked;
	}

	async getAvailability(input: {
		providerLocationId: string | null;
		providerServiceId: string | null;
		serviceName: string;
		durationMinutes: number;
		timezone: string;
		windowStart: Date;
		windowEnd: Date;
	}): Promise<SchedulerSlot[]> {
		void input.providerLocationId;
		void input.providerServiceId;
		void input.serviceName;
		const slots: SchedulerSlot[] = [];
		const local = localParts(input.windowStart, input.timezone);
		for (let dayOffset = 0; dayOffset < 14 && slots.length < 6; dayOffset += 1) {
			const localDay = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
			if (localDay.getUTCDay() === 0 || localDay.getUTCDay() === 6) continue;
			for (const hour of [9, 11, 13, 15]) {
				const startsAt = zonedTime(
					localDay.getUTCFullYear(),
					localDay.getUTCMonth() + 1,
					localDay.getUTCDate(),
					hour,
					input.timezone
				);
				const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
				if (startsAt < input.windowStart || endsAt > input.windowEnd) continue;
				const slot = {
					id: `fake-slot-${startsAt.toISOString()}`,
					startsAt: startsAt.toISOString(),
					endsAt: endsAt.toISOString(),
					timezone: input.timezone
				};
				if (this.slotIsReserved(slot)) continue;
				slots.push(slot);
				if (slots.length >= 6) break;
			}
		}
		return slots;
	}

	async hold(input: {
		providerLocationId: string | null;
		providerServiceId: string | null;
		slot: SchedulerSlot;
		customer: SchedulerCustomer;
		idempotencyKey: string;
	}): Promise<{ holdId: string; slot: SchedulerSlot; expiresAt: string }> {
		void input.providerLocationId;
		void input.providerServiceId;
		void input.customer;
		const existing = this.holds.get(input.idempotencyKey);
		if (existing) return { holdId: existing.id, slot: existing.slot, expiresAt: existing.expiresAt };
		if (this.slotIsReserved(input.slot)) {
			throw new Error('The selected appointment time is no longer available');
		}
		const hold = {
			id: `fake-hold-${input.idempotencyKey}`,
			slot: input.slot,
			expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
		};
		this.holds.set(input.idempotencyKey, hold);
		return { holdId: hold.id, slot: hold.slot, expiresAt: hold.expiresAt };
	}

	async book(input: {
		holdId: string;
		customer: SchedulerCustomer;
		notes: string;
		idempotencyKey: string;
	}): Promise<{ bookingId: string; slot: SchedulerSlot }> {
		void input.customer;
		void input.notes;
		const existing = this.bookings.get(input.idempotencyKey);
		if (existing) return { bookingId: existing.id, slot: existing.slot };
		const hold = [...this.holds.values()].find((item) => item.id === input.holdId);
		if (
			!hold ||
			this.cancelled.has(input.holdId) ||
			this.consumedHolds.has(input.holdId) ||
			new Date(hold.expiresAt).getTime() <= Date.now()
		) {
			throw new Error('The selected appointment hold has expired');
		}
		const booking = { id: `fake-booking-${input.idempotencyKey}`, slot: hold.slot };
		this.bookings.set(input.idempotencyKey, booking);
		this.consumedHolds.add(input.holdId);
		return { bookingId: booking.id, slot: booking.slot };
	}

	async cancel(input: {
		bookingId?: string;
		holdId?: string;
		reason: string;
		idempotencyKey: string;
	}): Promise<void> {
		void input.reason;
		this.cancelled.add(input.bookingId ?? input.holdId ?? input.idempotencyKey);
	}
}
