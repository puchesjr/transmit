export type SchedulerSlot = {
	id: string;
	startsAt: string;
	endsAt: string;
	timezone: string;
};

export type SchedulerCustomer = {
	name: string;
	phone: string;
	email: string | null;
	serviceAddress: string;
};

export interface SchedulerProvider {
	readonly name: 'fake' | 'design_partner';
	getAvailability(input: {
		providerLocationId: string | null;
		providerServiceId: string | null;
		serviceName: string;
		durationMinutes: number;
		timezone: string;
		windowStart: Date;
		windowEnd: Date;
	}): Promise<SchedulerSlot[]>;
	hold(input: {
		providerLocationId: string | null;
		providerServiceId: string | null;
		slot: SchedulerSlot;
		customer: SchedulerCustomer;
		idempotencyKey: string;
	}): Promise<{ holdId: string; slot: SchedulerSlot; expiresAt: string }>;
	book(input: {
		holdId: string;
		customer: SchedulerCustomer;
		notes: string;
		idempotencyKey: string;
	}): Promise<{ bookingId: string; slot: SchedulerSlot }>;
	cancel(input: {
		bookingId?: string;
		holdId?: string;
		reason: string;
		idempotencyKey: string;
	}): Promise<void>;
}

let provider: SchedulerProvider | undefined;

export function schedulerProviderConfigured(): boolean {
	const selected = process.env.SCHEDULER_PROVIDER?.trim();
	if (selected === 'fake') return process.env.NODE_ENV !== 'production';
	if (selected === 'design_partner' || (!selected && process.env.SCHEDULER_API_BASE_URL)) {
		return Boolean(process.env.SCHEDULER_API_BASE_URL && process.env.SCHEDULER_API_KEY);
	}
	if (selected) return false;
	return process.env.NODE_ENV !== 'production';
}

export async function getSchedulerProvider(): Promise<SchedulerProvider> {
	if (!provider) {
		const selected =
			process.env.SCHEDULER_PROVIDER?.trim() ||
			(process.env.SCHEDULER_API_BASE_URL ? 'design_partner' : 'fake');
		if (selected === 'fake') {
			if (process.env.NODE_ENV === 'production') {
				throw new Error('The fake scheduler cannot be used in production');
			}
			const { FakeSchedulerProvider } = await import('./fake-scheduler');
			provider = new FakeSchedulerProvider();
		} else if (selected === 'design_partner') {
			const { DesignPartnerSchedulerProvider } = await import('./design-partner-scheduler');
			provider = new DesignPartnerSchedulerProvider();
		} else {
			throw new Error(`Unsupported SCHEDULER_PROVIDER: ${selected}`);
		}
	}
	return provider;
}

export function setSchedulerProvider(override: SchedulerProvider | undefined): void {
	provider = override;
}
