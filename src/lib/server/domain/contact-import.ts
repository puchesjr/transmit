import { contactName } from '$lib/format';
import type { ContactImportResult } from '$lib/types';
import type { AuthContext } from '../context';
import type { Sql } from '../db';
import { AppError } from '../errors';
import { uuidv7 } from '../ids';
import { isUsE164, normalizeE164 } from '../phone';
import { insertActivity } from '../repos/activities';
import { findContactByEmail, findContactByPhone, insertContact } from '../repos/contacts';
import { asObject, requiredString } from '../validation';
import { queueOutboundWebhookEvent } from './outbound-webhooks';

const MAX_CSV_BYTES = 1_000_000;
const MAX_ROWS = 500;

export function parseContactImport(body: unknown): { csv: string } {
	const obj = asObject(body);
	const csv = requiredString(obj.csv, 'csv', MAX_CSV_BYTES);
	if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_BYTES) {
		throw new AppError('validation', 'CSV must be 1 MB or smaller');
	}
	return { csv };
}

function parseCsv(csv: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let index = 0; index < csv.length; index += 1) {
		const char = csv[index];
		if (quoted) {
			if (char === '"' && csv[index + 1] === '"') {
				field += '"';
				index += 1;
			} else if (char === '"') {
				quoted = false;
			} else {
				field += char;
			}
		} else if (char === '"' && field === '') {
			quoted = true;
		} else if (char === ',') {
			row.push(field.trim());
			field = '';
		} else if (char === '\n') {
			row.push(field.trim().replace(/\r$/, ''));
			if (row.some(Boolean)) rows.push(row);
			row = [];
			field = '';
		} else {
			field += char;
		}
	}
	if (quoted) throw new AppError('validation', 'CSV contains an unclosed quoted field');
	row.push(field.trim().replace(/\r$/, ''));
	if (row.some(Boolean)) rows.push(row);
	return rows;
}

function normalizedHeader(value: string): string {
	return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function columnIndex(headers: string[], aliases: string[]): number {
	return headers.findIndex((header) => aliases.includes(header));
}

function valueAt(row: string[], index: number): string {
	return index >= 0 ? (row[index] ?? '').trim() : '';
}

export async function importContactsCsv(
	sql: Sql,
	ctx: AuthContext,
	csv: string
): Promise<ContactImportResult> {
	if (ctx.role !== 'owner') throw new AppError('forbidden', 'Owner access required');
	const parsed = parseCsv(csv.replace(/^\uFEFF/, ''));
	if (parsed.length < 2) throw new AppError('validation', 'CSV must include a header and at least one row');
	const headers = parsed[0].map(normalizedHeader);
	const firstNameIndex = columnIndex(headers, ['first_name', 'firstname', 'given_name']);
	const lastNameIndex = columnIndex(headers, ['last_name', 'lastname', 'surname', 'family_name']);
	const fullNameIndex = columnIndex(headers, ['name', 'full_name']);
	const emailIndex = columnIndex(headers, ['email', 'email_address']);
	const phoneIndex = columnIndex(headers, ['phone', 'phone_number', 'mobile', 'mobile_phone']);
	if (firstNameIndex < 0 && lastNameIndex < 0 && fullNameIndex < 0) {
		throw new AppError('validation', 'CSV needs a name, first_name, or last_name column');
	}
	if (parsed.length - 1 > MAX_ROWS) {
		throw new AppError('validation', `CSV imports are limited to ${MAX_ROWS} contacts at a time`);
	}

	return sql.begin(async (tx) => {
		const result: ContactImportResult = {
			totalRows: parsed.length - 1,
			created: 0,
			matched: 0,
			skipped: 0,
			errors: []
		};
		for (let index = 1; index < parsed.length; index += 1) {
			const rowNumber = index + 1;
			const row = parsed[index];
			let firstName = valueAt(row, firstNameIndex).slice(0, 100);
			let lastName = valueAt(row, lastNameIndex).slice(0, 100);
			if (!firstName && !lastName) {
				const fullName = valueAt(row, fullNameIndex);
				const parts = fullName.split(/\s+/).filter(Boolean);
				firstName = (parts.shift() ?? '').slice(0, 100);
				lastName = parts.join(' ').slice(0, 100);
			}
			if (!firstName && !lastName) {
				result.skipped += 1;
				result.errors.push({ row: rowNumber, message: 'A name is required' });
				continue;
			}

			const rawEmail = valueAt(row, emailIndex).toLowerCase();
			const email = rawEmail || null;
			if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)) {
				result.skipped += 1;
				result.errors.push({ row: rowNumber, message: 'Email is invalid' });
				continue;
			}
			const rawPhone = valueAt(row, phoneIndex);
			const phone = rawPhone ? normalizeE164(rawPhone) : null;
			if (phone && !isUsE164(phone)) {
				result.skipped += 1;
				result.errors.push({ row: rowNumber, message: 'Phone must be a valid US number' });
				continue;
			}

			const existing =
				(phone ? await findContactByPhone(tx, ctx.accountId, phone) : null) ??
				(email ? await findContactByEmail(tx, ctx.accountId, email) : null);
			if (existing) {
				result.matched += 1;
				continue;
			}

			const contact = await insertContact(tx, {
				id: uuidv7(),
				accountId: ctx.accountId,
				locationId: ctx.locationId,
				firstName,
				lastName,
				email,
				phone,
				messagingConsent: 'unknown',
				createdBy: ctx.userId
			});
			await insertActivity(tx, {
				id: uuidv7(),
				accountId: ctx.accountId,
				contactId: contact.id,
				companyId: null,
				opportunityId: null,
				type: 'contact.created',
				summary: `${contactName(contact)} imported from CSV`,
				payload: { contactId: contact.id, source: 'csv_import' },
				createdBy: ctx.userId
			});
			await queueOutboundWebhookEvent(tx, {
				accountId: ctx.accountId,
				locationId: ctx.locationId,
				eventType: 'contact.created',
				data: { contact }
			});
			result.created += 1;
		}
		return result;
	});
}
