import type { BusinessHours, VoiceSettings } from '$lib/types';
import type { Queryable } from '../db';

export type LocationRow = {
	id: string;
	account_id: string;
	name: string;
	is_default: boolean;
	timezone: string;
	quiet_start: string | null;
	quiet_end: string | null;
	voice_forwarding_number: string | null;
	missed_call_textback_enabled: boolean;
	missed_call_template: string;
	business_hours: BusinessHours;
};

const LOCATION_COLUMNS = [
	'id',
	'account_id',
	'name',
	'is_default',
	'timezone',
	'quiet_start',
	'quiet_end',
	'voice_forwarding_number',
	'missed_call_textback_enabled',
	'missed_call_template',
	'business_hours'
] as const;

export async function insertLocation(
	sql: Queryable,
	row: { id: string; accountId: string; name: string; isDefault: boolean }
): Promise<void> {
	await sql`
		insert into locations (id, account_id, name, is_default)
		values (${row.id}, ${row.accountId}, ${row.name}, ${row.isDefault})
	`;
}

export async function getLocation(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<LocationRow | null> {
	const rows = await sql<LocationRow[]>`
		select ${sql(LOCATION_COLUMNS as unknown as string[])}
		from locations
		where account_id = ${accountId} and id = ${id}
		limit 1
	`;
	return rows[0] ?? null;
}

export async function getDefaultLocation(sql: Queryable, accountId: string): Promise<LocationRow | null> {
	const rows = await sql<LocationRow[]>`
		select ${sql(LOCATION_COLUMNS as unknown as string[])}
		from locations
		where account_id = ${accountId} and is_default = true
		limit 1
	`;
	return rows[0] ?? null;
}

export function mapVoiceSettings(location: LocationRow): VoiceSettings {
	return {
		locationId: location.id,
		timezone: location.timezone,
		forwardingNumber: location.voice_forwarding_number,
		missedCallTextbackEnabled: location.missed_call_textback_enabled,
		missedCallTemplate: location.missed_call_template,
		businessHours: location.business_hours
	};
}

export async function updateLocationVoiceSettings(
	sql: Queryable,
	accountId: string,
	locationId: string,
	settings: Omit<VoiceSettings, 'locationId'>
): Promise<LocationRow | null> {
	const rows = await sql<LocationRow[]>`
		update locations
		set timezone = ${settings.timezone},
			voice_forwarding_number = ${settings.forwardingNumber},
			missed_call_textback_enabled = ${settings.missedCallTextbackEnabled},
			missed_call_template = ${settings.missedCallTemplate},
			business_hours = ${sql.json(settings.businessHours as never)},
			updated_at = now()
		where account_id = ${accountId} and id = ${locationId}
		returning ${sql(LOCATION_COLUMNS as unknown as string[])}
	`;
	return rows[0] ?? null;
}

export async function updateLocationQuietHours(
	sql: Queryable,
	accountId: string,
	locationId: string,
	settings: { timezone: string; quietStart: string | null; quietEnd: string | null }
): Promise<void> {
	await sql`
		update locations
		set timezone = ${settings.timezone},
			quiet_start = ${settings.quietStart},
			quiet_end = ${settings.quietEnd},
			updated_at = now()
		where account_id = ${accountId} and id = ${locationId}
	`;
}
