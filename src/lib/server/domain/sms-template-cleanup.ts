import type { Queryable } from '../db';
import { normalizeSms } from '../../sms';

/** Owner/operator maintenance: only reusable templates and unused AI drafts. */
export async function cleanStoredSmsTemplates(sql: Queryable, accountId: string, apply = false) {
	const report = { changed: 0, blocked: 0, applied: 0 };
	const fields = [
		['locations', 'id', 'missed_call_template'],
		['lead_forms', 'id', 'reply_template'],
		['booking_settings', 'location_id', 'confirmation_template']
	] as const;
	for (const [table, key, column] of fields) {
		const rows = await sql<{ id: string; body: string }[]>`
			select ${sql(key)} as id, ${sql(column)} as body from ${sql(table)} where account_id = ${accountId}`;
		for (const row of rows) {
			const normalized = normalizeSms(row.body);
			if (!normalized.changed) continue;
			if (normalized.unsupportedText || !normalized.text) { report.blocked++; continue; }
			report.changed++;
			if (apply) {
				const updated = await sql`update ${sql(table)} set ${sql(column)} = ${normalized.text}
					where account_id = ${accountId} and ${sql(key)} = ${row.id} and ${sql(column)} = ${row.body} returning ${sql(key)}`;
				report.applied += updated.length;
			}
		}
	}
	const drafts = await sql<{ id: string; content: Record<string, unknown> }[]>`
		select id,content from ai_artifacts where account_id = ${accountId} and status = 'ready' and kind in ('reply','follow_up')`;
	for (const draft of drafts) {
		const content = structuredClone(draft.content);
		const bodies = Array.isArray(content.choices) ? content.choices : [content];
		let changed = false, blocked = false;
		for (const item of bodies) {
			if (!item || typeof item.body !== 'string') continue;
			const normalized = normalizeSms(item.body);
			blocked ||= normalized.unsupportedText || !normalized.text;
			changed ||= normalized.changed;
			item.body = normalized.text;
		}
		if (!changed) continue;
		if (blocked) { report.blocked++; continue; }
		report.changed++;
		if (apply) {
			const updated = await sql`update ai_artifacts set content = ${sql.json(content as never)}, updated_at = now()
				where account_id = ${accountId} and id = ${draft.id} and status = 'ready'
				and content = ${sql.json(draft.content as never)} returning id`;
			report.applied += updated.length;
		}
	}
	return report;
}
