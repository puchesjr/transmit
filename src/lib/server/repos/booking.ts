import type { SchedulerCustomer } from '../providers/scheduler';
import type {
	Appointment,
	BookingQualification,
	BookingService,
	BookingSession,
	BookingSessionStatus,
	BookingSettings,
	BookingSlot
} from '$lib/types';
import type { Queryable } from '../db';
import { uuidv7 } from '../ids';

type BookingSettingsRow = {
	location_id: string;
	enabled: boolean;
	provider_location_id: string | null;
	minimum_notice_minutes: number;
	booking_window_days: number;
	session_timeout_minutes: number;
	confirmation_template: string;
};

type BookingServiceRow = {
	id: string;
	location_id: string;
	name: string;
	duration_minutes: number;
	provider_service_id: string | null;
	enabled: boolean;
	created_at: Date;
	updated_at: Date;
};

type BookingSessionRow = {
	customer_input: Omit<SchedulerCustomer, 'serviceAddress'> | null;
	id: string;
	account_id: string;
	location_id: string;
	form_id: string;
	capture_id: string;
	contact_id: string;
	conversation_id: string;
	opportunity_id: string;
	service_id: string;
	service_name: string;
	public_token_hash: string;
	submission_key: string;
	status: BookingSessionStatus;
	qualification: BookingQualification;
	offered_slots: BookingSlot[];
	scheduler_hold_id: string | null;
	selected_slot_id: string | null;
	held_start: Date | null;
	held_end: Date | null;
	held_timezone: string | null;
	hold_expires_at: Date | null;
	ai_provider: string | null;
	ai_model: string | null;
	handoff_reason: string | null;
	taken_over_by: string | null;
	ip_hash: string | null;
	expires_at: Date;
	created_at: Date;
	updated_at: Date;
};

type AppointmentRow = {
	id: string;
	location_id: string;
	booking_session_id: string;
	contact_id: string;
	opportunity_id: string;
	service_id: string;
	provider: string;
	provider_booking_id: string;
	idempotency_key: string;
	starts_at: Date;
	ends_at: Date;
	timezone: string;
	status: Appointment['status'];
	cancellation_reason: string | null;
	created_at: Date;
	updated_at: Date;
};

export type BookingSessionRecord = BookingSession & {
	customerInput: Omit<SchedulerCustomer, 'serviceAddress'> | null;
	accountId: string;
	formId: string;
	captureId: string;
	publicTokenHash: string;
	submissionKey: string;
	offeredSlots: BookingSlot[];
	schedulerHoldId: string | null;
	selectedSlotId: string | null;
	aiProvider: string | null;
	aiModel: string | null;
	ipHash: string | null;
};

const SETTINGS_COLUMNS = [
	'location_id',
	'enabled',
	'provider_location_id',
	'minimum_notice_minutes',
	'booking_window_days',
	'session_timeout_minutes',
	'confirmation_template'
] as const;

const SERVICE_COLUMNS = [
	'id',
	'location_id',
	'name',
	'duration_minutes',
	'provider_service_id',
	'enabled',
	'created_at',
	'updated_at'
] as const;

const APPOINTMENT_COLUMNS = [
	'id',
	'location_id',
	'booking_session_id',
	'contact_id',
	'opportunity_id',
	'service_id',
	'provider',
	'provider_booking_id',
	'idempotency_key',
	'starts_at',
	'ends_at',
	'timezone',
	'status',
	'cancellation_reason',
	'created_at',
	'updated_at'
] as const;

function mapSettings(row: BookingSettingsRow): BookingSettings {
	return {
		locationId: row.location_id,
		enabled: row.enabled,
		providerLocationId: row.provider_location_id,
		minimumNoticeMinutes: row.minimum_notice_minutes,
		bookingWindowDays: row.booking_window_days,
		sessionTimeoutMinutes: row.session_timeout_minutes,
		confirmationTemplate: row.confirmation_template
	};
}

function mapService(row: BookingServiceRow): BookingService {
	return {
		id: row.id,
		locationId: row.location_id,
		name: row.name,
		durationMinutes: row.duration_minutes,
		providerServiceId: row.provider_service_id,
		enabled: row.enabled,
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString()
	};
}

function mapSession(row: BookingSessionRow): BookingSessionRecord {
	return {
		customerInput: row.customer_input,
		id: row.id,
		accountId: row.account_id,
		locationId: row.location_id,
		formId: row.form_id,
		captureId: row.capture_id,
		contactId: row.contact_id,
		conversationId: row.conversation_id,
		opportunityId: row.opportunity_id,
		serviceId: row.service_id,
		serviceName: row.service_name,
		publicTokenHash: row.public_token_hash,
		submissionKey: row.submission_key,
		status: row.status,
		qualification: row.qualification,
		offeredSlots: row.offered_slots ?? [],
		schedulerHoldId: row.scheduler_hold_id,
		selectedSlotId: row.selected_slot_id,
		heldSlot:
			row.selected_slot_id && row.held_start && row.held_end
				? {
						id: row.selected_slot_id,
						startsAt: row.held_start.toISOString(),
						endsAt: row.held_end.toISOString(),
						timezone: row.held_timezone ?? 'UTC'
					}
				: null,
		holdExpiresAt: row.hold_expires_at?.toISOString() ?? null,
		aiProvider: row.ai_provider,
		aiModel: row.ai_model,
		handoffReason: row.handoff_reason,
		takenOverBy: row.taken_over_by,
		ipHash: row.ip_hash,
		expiresAt: row.expires_at.toISOString(),
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString()
	};
}

function mapAppointment(row: AppointmentRow): Appointment {
	return {
		id: row.id,
		locationId: row.location_id,
		bookingSessionId: row.booking_session_id,
		contactId: row.contact_id,
		opportunityId: row.opportunity_id,
		serviceId: row.service_id,
		provider: row.provider,
		startsAt: row.starts_at.toISOString(),
		endsAt: row.ends_at.toISOString(),
		timezone: row.timezone,
		status: row.status,
		cancellationReason: row.cancellation_reason,
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString()
	};
}

export async function ensureBookingDefaults(
	sql: Queryable,
	accountId: string,
	locationId: string
): Promise<void> {
	await sql`
		insert into booking_settings (account_id, location_id)
		values (${accountId}, ${locationId})
		on conflict (account_id, location_id) do nothing
	`;
	await sql`
		insert into booking_services (
			id, account_id, location_id, name, duration_minutes, provider_service_id
		)
		values (${uuidv7()}, ${accountId}, ${locationId}, 'Service visit', 60, null)
		on conflict (account_id, location_id, name) do nothing
	`;
}

export async function getBookingSettings(
	sql: Queryable,
	accountId: string,
	locationId: string
): Promise<BookingSettings | null> {
	const rows = await sql<BookingSettingsRow[]>`
		select ${sql(SETTINGS_COLUMNS as unknown as string[])}
		from booking_settings
		where account_id = ${accountId} and location_id = ${locationId}
		limit 1
	`;
	return rows[0] ? mapSettings(rows[0]) : null;
}

export async function updateBookingSettings(
	sql: Queryable,
	accountId: string,
	locationId: string,
	settings: Omit<BookingSettings, 'locationId'>
): Promise<BookingSettings | null> {
	const rows = await sql<BookingSettingsRow[]>`
		update booking_settings
		set enabled = ${settings.enabled},
			provider_location_id = ${settings.providerLocationId},
			minimum_notice_minutes = ${settings.minimumNoticeMinutes},
			booking_window_days = ${settings.bookingWindowDays},
			session_timeout_minutes = ${settings.sessionTimeoutMinutes},
			confirmation_template = ${settings.confirmationTemplate},
			updated_at = now()
		where account_id = ${accountId} and location_id = ${locationId}
		returning ${sql(SETTINGS_COLUMNS as unknown as string[])}
	`;
	return rows[0] ? mapSettings(rows[0]) : null;
}

export async function listBookingServices(
	sql: Queryable,
	accountId: string,
	locationId: string,
	includeDisabled = true
): Promise<BookingService[]> {
	const rows = await sql<BookingServiceRow[]>`
		select ${sql(SERVICE_COLUMNS as unknown as string[])}
		from booking_services
		where account_id = ${accountId} and location_id = ${locationId}
			${includeDisabled ? sql`` : sql`and enabled = true`}
		order by enabled desc, name asc, id asc
	`;
	return rows.map(mapService);
}

export async function getBookingService(
	sql: Queryable,
	accountId: string,
	locationId: string,
	id: string
): Promise<BookingService | null> {
	const rows = await sql<BookingServiceRow[]>`
		select ${sql(SERVICE_COLUMNS as unknown as string[])}
		from booking_services
		where account_id = ${accountId} and location_id = ${locationId} and id = ${id}
		limit 1
	`;
	return rows[0] ? mapService(rows[0]) : null;
}

export async function insertBookingService(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		locationId: string;
		name: string;
		durationMinutes: number;
		providerServiceId: string | null;
	}
): Promise<BookingService> {
	const rows = await sql<BookingServiceRow[]>`
		insert into booking_services (
			id, account_id, location_id, name, duration_minutes, provider_service_id
		)
		values (
			${row.id}, ${row.accountId}, ${row.locationId}, ${row.name},
			${row.durationMinutes}, ${row.providerServiceId}
		)
		returning ${sql(SERVICE_COLUMNS as unknown as string[])}
	`;
	return mapService(rows[0]);
}

export async function updateBookingService(
	sql: Queryable,
	accountId: string,
	locationId: string,
	id: string,
	input: Pick<BookingService, 'name' | 'durationMinutes' | 'providerServiceId' | 'enabled'>
): Promise<BookingService | null> {
	const rows = await sql<BookingServiceRow[]>`
		update booking_services
		set name = ${input.name}, duration_minutes = ${input.durationMinutes},
			provider_service_id = ${input.providerServiceId}, enabled = ${input.enabled},
			updated_at = now()
		where account_id = ${accountId} and location_id = ${locationId} and id = ${id}
		returning ${sql(SERVICE_COLUMNS as unknown as string[])}
	`;
	return rows[0] ? mapService(rows[0]) : null;
}

async function loadSession(
	sql: Queryable,
	accountId: string,
	where: ReturnType<Queryable>
): Promise<BookingSessionRecord | null> {
	const rows = await sql<BookingSessionRow[]>`
		select bs.id, bs.account_id, bs.location_id, bs.form_id, bs.capture_id,
			bs.contact_id, bs.conversation_id, bs.opportunity_id, bs.service_id,
			s.name as service_name, bs.public_token_hash, bs.submission_key, bs.status,
			bs.qualification, bs.offered_slots, bs.scheduler_hold_id, bs.selected_slot_id,
			bs.held_start, bs.held_end, bs.held_timezone, bs.hold_expires_at,
			bs.ai_provider, bs.ai_model, bs.handoff_reason, bs.taken_over_by, bs.ip_hash,
			bs.expires_at, bs.created_at, bs.updated_at, bs.customer_input
		from booking_sessions bs
		join booking_services s on s.account_id = bs.account_id and s.id = bs.service_id
		where bs.account_id = ${accountId} and ${where}
		order by bs.created_at desc, bs.id desc
		limit 1
	`;
	return rows[0] ? mapSession(rows[0]) : null;
}

export function getBookingSession(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<BookingSessionRecord | null> {
	return loadSession(sql, accountId, sql`bs.id = ${id}`);
}

export function getBookingSessionByTokenHash(
	sql: Queryable,
	accountId: string,
	tokenHash: string
): Promise<BookingSessionRecord | null> {
	return loadSession(sql, accountId, sql`bs.public_token_hash = ${tokenHash}`);
}

export function getBookingSessionBySubmissionKey(
	sql: Queryable,
	accountId: string,
	formId: string,
	submissionKey: string
): Promise<BookingSessionRecord | null> {
	return loadSession(
		sql,
		accountId,
		sql`bs.form_id = ${formId} and bs.submission_key = ${submissionKey}`
	);
}

export function getBookingSessionForConversation(
	sql: Queryable,
	accountId: string,
	conversationId: string
): Promise<BookingSessionRecord | null> {
	return loadSession(sql, accountId, sql`bs.conversation_id = ${conversationId}`);
}

export async function insertBookingSession(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		locationId: string;
		formId: string;
		captureId: string;
		contactId: string;
		conversationId: string;
		opportunityId: string;
		serviceId: string;
		publicTokenHash: string;
		submissionKey: string;
		ipHash: string | null;
		customerInput: Omit<SchedulerCustomer, 'serviceAddress'>;
		expiresAt: Date;
	}
): Promise<void> {
	await sql`
		insert into booking_sessions (
			id, account_id, location_id, form_id, capture_id, contact_id, conversation_id,
			opportunity_id, service_id, public_token_hash, submission_key, ip_hash, expires_at, customer_input
		)
		values (
			${row.id}, ${row.accountId}, ${row.locationId}, ${row.formId}, ${row.captureId},
			${row.contactId}, ${row.conversationId}, ${row.opportunityId}, ${row.serviceId},
			${row.publicTokenHash}, ${row.submissionKey}, ${row.ipHash}, ${row.expiresAt}, ${sql.json(row.customerInput)}
		)
	`;
}

export async function countRecentBookingSessionsByIpHash(
	sql: Queryable,
	accountId: string,
	ipHash: string,
	since: Date
): Promise<number> {
	const rows = await sql<{ count: string | number }[]>`
		select count(*) as count
		from booking_sessions
		where account_id = ${accountId} and ip_hash = ${ipHash} and created_at >= ${since}
	`;
	return Number(rows[0]?.count ?? 0);
}

export async function updateBookingQualification(
	sql: Queryable,
	accountId: string,
	id: string,
	input: {
		qualification: BookingQualification;
		offeredSlots: BookingSlot[];
		status: 'qualifying' | 'offering';
		aiProvider: string;
		aiModel: string;
		expiresAt: Date;
	}
): Promise<boolean> {
	const rows = await sql<{ id: string }[]>`
		update booking_sessions
		set qualification = ${sql.json(input.qualification as never)},
			offered_slots = ${sql.json(input.offeredSlots as never)}, status = ${input.status},
			ai_provider = ${input.aiProvider}, ai_model = ${input.aiModel},
			last_activity_at = now(), expires_at = ${input.expiresAt}, updated_at = now()
		where account_id = ${accountId} and id = ${id}
			and status in ('qualifying', 'offering') and taken_over_by is null
		returning id
	`;
	return rows.length > 0;
}

export async function setBookingHold(
	sql: Queryable,
	accountId: string,
	id: string,
	input: { holdId: string; slot: BookingSlot; expiresAt: Date }
): Promise<boolean> {
	const rows = await sql<{ id: string }[]>`
		update booking_sessions
		set status = 'held', scheduler_hold_id = ${input.holdId},
			selected_slot_id = ${input.slot.id}, held_start = ${new Date(input.slot.startsAt)},
			held_end = ${new Date(input.slot.endsAt)}, held_timezone = ${input.slot.timezone},
			hold_expires_at = ${input.expiresAt},
			offered_slots = '[]'::jsonb, last_activity_at = now(),
			expires_at = ${input.expiresAt}, updated_at = now()
		where account_id = ${accountId} and id = ${id}
			and status = 'offering' and taken_over_by is null and expires_at > now()
			and offered_slots @> ${sql.json([input.slot])}
		returning id
	`;
	return rows.length > 0;
}

export async function setBookingHandoff(
	sql: Queryable,
	accountId: string,
	id: string,
	reason: string,
	takenOverBy: string | null = null
): Promise<boolean> {
	const rows = await sql<{ id: string }[]>`
		update booking_sessions
		set status = 'handoff', handoff_reason = ${reason.slice(0, 500)},
			taken_over_by = coalesce(${takenOverBy}, taken_over_by),
			last_activity_at = now(), updated_at = now()
		where account_id = ${accountId} and id = ${id}
			and status not in ('booked', 'cancelled', 'expired')
		returning id
	`;
	return rows.length > 0;
}

export async function setBookingExpired(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<boolean> {
	const rows = await sql<{ id: string }[]>`
		update booking_sessions
		set status = 'expired', handoff_reason = 'The website conversation timed out',
			updated_at = now()
		where account_id = ${accountId} and id = ${id}
			and status in ('qualifying', 'offering', 'held') and expires_at <= now()
		returning id
	`;
	return rows.length > 0;
}

export async function setBookingBooked(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<boolean> {
	const rows = await sql<{ id: string }[]>`
		update booking_sessions
		set status = 'booked', last_activity_at = now(), updated_at = now()
		where account_id = ${accountId} and id = ${id}
			and status = 'held' and taken_over_by is null
		returning id
	`;
	return rows.length > 0;
}

export async function setBookingCancelled(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<boolean> {
	const rows = await sql<{ id: string }[]>`
		update booking_sessions
		set status = 'cancelled', last_activity_at = now(), updated_at = now()
		where account_id = ${accountId} and id = ${id} and status <> 'cancelled'
		returning id
	`;
	return rows.length > 0;
}

export async function touchBookingSession(
	sql: Queryable,
	accountId: string,
	id: string,
	expiresAt: Date
): Promise<void> {
	await sql`
		update booking_sessions
		set last_activity_at = now(), expires_at = ${expiresAt}, updated_at = now()
		where account_id = ${accountId} and id = ${id}
	`;
}

export async function insertAppointment(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		locationId: string;
		bookingSessionId: string;
		contactId: string;
		opportunityId: string;
		serviceId: string;
		provider: string;
		providerBookingId: string;
		idempotencyKey: string;
		slot: BookingSlot;
	}
): Promise<Appointment | null> {
	const rows = await sql<AppointmentRow[]>`
		insert into appointments (
			id, account_id, location_id, booking_session_id, contact_id, opportunity_id,
			service_id, provider, provider_booking_id, idempotency_key, starts_at, ends_at, timezone
		)
		values (
			${row.id}, ${row.accountId}, ${row.locationId}, ${row.bookingSessionId},
			${row.contactId}, ${row.opportunityId}, ${row.serviceId}, ${row.provider},
			${row.providerBookingId}, ${row.idempotencyKey}, ${new Date(row.slot.startsAt)},
			${new Date(row.slot.endsAt)}, ${row.slot.timezone}
		)
		on conflict do nothing
		returning ${sql(APPOINTMENT_COLUMNS as unknown as string[])}
	`;
	return rows[0] ? mapAppointment(rows[0]) : null;
}

export async function getAppointmentForSession(
	sql: Queryable,
	accountId: string,
	bookingSessionId: string
): Promise<Appointment | null> {
	const rows = await sql<AppointmentRow[]>`
		select ${sql(APPOINTMENT_COLUMNS as unknown as string[])}
		from appointments
		where account_id = ${accountId} and booking_session_id = ${bookingSessionId}
		limit 1
	`;
	return rows[0] ? mapAppointment(rows[0]) : null;
}

export async function cancelAppointment(
	sql: Queryable,
	accountId: string,
	id: string,
	reason: string
): Promise<Appointment | null> {
	const rows = await sql<AppointmentRow[]>`
		update appointments
		set status = 'cancelled', cancellation_reason = ${reason.slice(0, 500)},
			cancelled_at = now(), updated_at = now()
		where account_id = ${accountId} and id = ${id} and status = 'booked'
		returning ${sql(APPOINTMENT_COLUMNS as unknown as string[])}
	`;
	return rows[0] ? mapAppointment(rows[0]) : null;
}
