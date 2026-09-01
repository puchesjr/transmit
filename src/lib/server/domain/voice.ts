import { contactName } from '$lib/format';
import type { BusinessDayKey, BusinessHours, Call, VoiceSettings } from '$lib/types';
import type { AuthContext } from '../context';
import type { Queryable, Sql } from '../db';
import { AppError } from '../errors';
import { uuidv7 } from '../ids';
import { log } from '../logger';
import { isUsE164, normalizeE164 } from '../phone';
import type { NormalizedVoiceWebhookEvent, VoiceProvider } from '../providers/voice';
import { insertActivity } from '../repos/activities';
import {
	attachCallTextback,
	finalizeCall,
	getCallBySession,
	insertInboundCall,
	listCalls,
	markCallAnswered,
	markCallForwarding,
	type CallRecord
} from '../repos/calls';
import { findContactByPhone, getContact, insertContact } from '../repos/contacts';
import {
	getLocation,
	mapVoiceSettings,
	updateLocationVoiceSettings,
	type LocationRow
} from '../repos/locations';
import { findNumberByE164, getActiveNumberForLocation } from '../repos/phone-numbers';
import { asObject, optionalString, requiredString } from '../validation';
import { queueAutomatedSms } from './messaging';
import { recordUsage } from './billing';
import { queueOutboundWebhookEvent } from './outbound-webhooks';

const DAY_KEYS: BusinessDayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_TO_KEY: Record<string, BusinessDayKey> = {
	Mon: 'mon',
	Tue: 'tue',
	Wed: 'wed',
	Thu: 'thu',
	Fri: 'fri',
	Sat: 'sat',
	Sun: 'sun'
};
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TERMINAL_STATUSES = new Set(['missed', 'completed', 'failed']);

function parseBusinessHours(value: unknown): BusinessHours {
	const obj = asObject(value);
	const result = {} as BusinessHours;
	for (const day of DAY_KEYS) {
		const input = asObject(obj[day]);
		if (typeof input.enabled !== 'boolean') {
			throw new AppError('validation', `${day}.enabled is invalid`);
		}
		const opensAt = requiredString(input.opensAt, `${day}.opensAt`, 5);
		const closesAt = requiredString(input.closesAt, `${day}.closesAt`, 5);
		if (!TIME_RE.test(opensAt) || !TIME_RE.test(closesAt) || opensAt >= closesAt) {
			throw new AppError('validation', `${day} business hours are invalid`);
		}
		result[day] = { enabled: input.enabled, opensAt, closesAt };
	}
	return result;
}

export function parseVoiceSettings(body: unknown): Omit<VoiceSettings, 'locationId'> {
	const obj = asObject(body);
	const rawForwarding = optionalString(obj.forwardingNumber, 'forwardingNumber', 30);
	const forwardingNumber = rawForwarding ? normalizeE164(rawForwarding) : null;
	if (forwardingNumber && !isUsE164(forwardingNumber)) {
		throw new AppError('validation', 'forwardingNumber must be a US number');
	}
	if (typeof obj.missedCallTextbackEnabled !== 'boolean') {
		throw new AppError('validation', 'missedCallTextbackEnabled is invalid');
	}
	const missedCallTemplate = requiredString(obj.missedCallTemplate, 'missedCallTemplate', 480);
	if (!/\bSTOP\b/i.test(missedCallTemplate)) {
		throw new AppError('validation', 'missedCallTemplate must include STOP opt-out instructions');
	}
	const timezone = requiredString(obj.timezone, 'timezone', 100);
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
	} catch {
		throw new AppError('validation', 'timezone is invalid');
	}
	return {
		timezone,
		forwardingNumber,
		missedCallTextbackEnabled: obj.missedCallTextbackEnabled,
		missedCallTemplate,
		businessHours: parseBusinessHours(obj.businessHours)
	};
}

function minutes(value: string): number {
	const [hour = 0, minute = 0] = value.split(':').map(Number);
	return hour * 60 + minute;
}

export function isWithinBusinessHours(
	location: Pick<LocationRow, 'timezone' | 'business_hours'>,
	now: Date
): boolean {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: location.timezone,
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(now);
	const day = WEEKDAY_TO_KEY[parts.find((part) => part.type === 'weekday')?.value ?? ''];
	if (!day) return false;
	const schedule = location.business_hours[day];
	if (!schedule?.enabled) return false;
	const localMinutes =
		(Number(parts.find((part) => part.type === 'hour')?.value ?? 0) % 24) * 60 +
		Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
	return localMinutes >= minutes(schedule.opensAt) && localMinutes < minutes(schedule.closesAt);
}

export async function getVoiceSettings(sql: Sql, ctx: AuthContext): Promise<VoiceSettings> {
	const location = await getLocation(sql, ctx.accountId, ctx.locationId);
	if (!location) throw new AppError('not_found', 'Location not found');
	return mapVoiceSettings(location);
}

export async function saveVoiceSettings(
	sql: Sql,
	ctx: AuthContext,
	settings: Omit<VoiceSettings, 'locationId'>
): Promise<VoiceSettings> {
	const number = await getActiveNumberForLocation(sql, ctx.accountId, ctx.locationId);
	if (number && settings.forwardingNumber === number.e164) {
		throw new AppError('validation', 'Forwarding number cannot be the location number');
	}
	const updated = await updateLocationVoiceSettings(
		sql,
		ctx.accountId,
		ctx.locationId,
		settings
	);
	if (!updated) throw new AppError('not_found', 'Location not found');
	return mapVoiceSettings(updated);
}

export async function listAccountCalls(sql: Sql, ctx: AuthContext): Promise<Call[]> {
	return listCalls(sql, ctx.accountId);
}

function dateOr(value: string | null, fallback: Date): Date {
	if (!value) return fallback;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

async function resolveLocationNumber(sql: Queryable, event: NormalizedVoiceWebhookEvent) {
	const to = normalizeE164(event.to);
	const from = normalizeE164(event.from);
	return (await findNumberByE164(sql, to)) ?? (await findNumberByE164(sql, from));
}

async function ensureInboundCall(
	sql: Sql,
	event: NormalizedVoiceWebhookEvent
): Promise<{ call: CallRecord; location: LocationRow; accountId: string; numberE164: string } | null> {
	const number = await resolveLocationNumber(sql, event);
	if (!number) {
		log('warn', 'voice_unknown_number', { from: event.from, to: event.to, type: event.type });
		return null;
	}

	const existing = await getCallBySession(sql, number.accountId, event.callSessionId);
	const location = await getLocation(sql, number.accountId, number.locationId);
	if (!location) return null;
	if (existing) return { call: existing, location, accountId: number.accountId, numberE164: number.e164 };

	// Only an inbound leg contains enough caller identity to recover a missing,
	// out-of-order call.initiated event. Outbound transfer legs are ignored until
	// their inbound session row exists.
	if (normalizeE164(event.to) !== number.e164) return null;
	const caller = normalizeE164(event.from);
	const startedAt = dateOr(event.startTime, dateOr(event.occurredAt, new Date()));
	const afterHours = !isWithinBusinessHours(location, startedAt);

	const call = await sql.begin(async (tx) => {
		let contact = await findContactByPhone(tx, number.accountId, caller);
		let created = false;
		if (!contact) {
			contact = await insertContact(tx, {
				id: uuidv7(),
				accountId: number.accountId,
				locationId: number.locationId,
				firstName: 'Caller',
				lastName: caller.slice(-4),
				email: null,
				phone: caller,
				createdBy: null
			});
			created = true;
		}
		if (created) {
			await insertActivity(tx, {
				id: uuidv7(),
				accountId: number.accountId,
				contactId: contact.id,
				companyId: null,
				opportunityId: null,
				type: 'contact.created',
				summary: `Customer created from inbound call (${caller})`,
				payload: { contactId: contact.id },
				createdBy: null
			});
			await queueOutboundWebhookEvent(tx, {
				accountId: number.accountId,
				locationId: number.locationId,
				eventType: 'contact.created',
				data: { contact }
			});
		}
		return insertInboundCall(tx, {
			id: uuidv7(),
			accountId: number.accountId,
			locationId: number.locationId,
			contactId: contact.id,
			phoneNumberId: number.id,
			providerCallSessionId: event.callSessionId,
			providerCallControlId: event.callControlId,
			from: caller,
			to: number.e164,
			startedAt,
			afterHours
		});
	});

	return { call, location, accountId: number.accountId, numberE164: number.e164 };
}

async function finalize(
	sql: Sql,
	call: CallRecord,
	location: LocationRow,
	accountId: string,
	event: NormalizedVoiceWebhookEvent,
	status: 'missed' | 'completed' | 'failed',
	hangupCause: string | null
): Promise<void> {
	const endedAt = dateOr(event.endTime, dateOr(event.occurredAt, new Date()));
	const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - call.startedAt.getTime()) / 1000));

	await sql.begin(async (tx) => {
		const completed = await finalizeCall(tx, accountId, call.id, {
			status,
			endedAt,
			durationSeconds,
			hangupCause
		});
		if (!completed) return;
		await recordUsage(tx, {
			accountId,
			locationId: completed.locationId,
			metric: 'call_second',
			quantity: durationSeconds,
			sourceType: 'call',
			sourceId: completed.id,
			occurredAt: endedAt
		});
		const contact = await getContact(tx, accountId, completed.contactId);
		if (!contact) return;
		const missed = status === 'missed';
		await insertActivity(tx, {
			id: uuidv7(),
			accountId,
			contactId: contact.id,
			companyId: null,
			opportunityId: null,
			type: missed ? 'call.missed' : status === 'completed' ? 'call.completed' : 'call.failed',
			summary: missed
				? `Missed call from ${contactName(contact)}${completed.afterHours ? ' after hours' : ''}`
				: status === 'completed'
					? `Call with ${contactName(contact)} completed (${durationSeconds}s)`
					: `Call from ${contactName(contact)} failed`,
			payload: {
				callId: completed.id,
				durationSeconds,
				hangupCause,
				afterHours: completed.afterHours
			},
			createdBy: null
		});

		if (missed && location.missed_call_textback_enabled && !completed.textbackMessageId) {
			const message = await queueAutomatedSms(tx, {
				accountId,
				locationId: completed.locationId,
				contactId: completed.contactId,
				body: location.missed_call_template,
				reason: 'missed_call'
			});
			if (message) await attachCallTextback(tx, accountId, completed.id, message.id);
		}
	});
}

export async function processVoiceEvent(
	sql: Sql,
	provider: VoiceProvider,
	payload: Record<string, unknown>
): Promise<void> {
	const event = payload.event as NormalizedVoiceWebhookEvent | undefined;
	if (!event) return;
	const loaded = await ensureInboundCall(sql, event);
	if (!loaded) return;
	let { call } = loaded;
	const { location, accountId, numberE164 } = loaded;
	if (TERMINAL_STATUSES.has(call.status)) return;

	if (event.type === 'initiated') {
		if (call.afterHours || !location.voice_forwarding_number) {
			await provider.rejectCall({ callControlId: call.providerCallControlId, commandId: event.eventId });
			await finalize(
				sql,
				call,
				location,
				accountId,
				event,
				'missed',
				call.afterHours ? 'after_hours' : 'forwarding_not_configured'
			);
			return;
		}
		await provider.answerCall({ callControlId: call.providerCallControlId, commandId: event.eventId });
		return;
	}

	if (event.type === 'answered') {
		if (event.callControlId === call.providerCallControlId && call.status === 'ringing') {
			if (!location.voice_forwarding_number) {
				await finalize(sql, call, location, accountId, event, 'missed', 'forwarding_not_configured');
				return;
			}
			await provider.transferCall({
				callControlId: call.providerCallControlId,
				to: location.voice_forwarding_number,
				from: numberE164,
				commandId: event.eventId,
				timeoutSeconds: 25
			});
			await markCallForwarding(sql, accountId, call.id);
			return;
		}
		await markCallAnswered(sql, accountId, call.id, dateOr(event.occurredAt, new Date()));
		return;
	}

	if (event.type === 'bridged') {
		await markCallAnswered(sql, accountId, call.id, dateOr(event.occurredAt, new Date()));
		return;
	}

	call = (await getCallBySession(sql, accountId, event.callSessionId)) ?? call;
	const completed = call.status === 'answered' || call.answeredAt !== null;
	await finalize(
		sql,
		call,
		location,
		accountId,
		event,
		completed ? 'completed' : 'missed',
		event.hangupCause
	);
}
