import { normalizeSms, smsMetrics } from '$lib/sms';
import { AppError } from '../errors';

export function prepareSms(body: string): { body: string; segments: number } {
	const normalized = normalizeSms(body);
	if (normalized.unsupportedText) throw new AppError('validation', 'Rewrite unsupported letters or numbers using GSM-7 characters before sending.');
	if (!normalized.text) throw new AppError('validation', 'Message is empty after removing unsupported characters.');
	const metrics = smsMetrics(normalized.text);
	if (metrics.encoding !== 'GSM-7' || metrics.segments > 10) throw new AppError('validation', 'SMS must fit within 10 GSM-7 segments. Shorten the message.');
	return { body: normalized.text, segments: metrics.segments };
}
