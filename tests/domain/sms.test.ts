import { describe, expect, it } from 'vitest';
import { gsmUnits, normalizeSms, smsMetrics } from '$lib/sms';
import { prepareSms } from '$lib/server/domain/sms';

describe('SMS encoding and segment boundaries', () => {
 it('counts 160/153 GSM units and two-unit extension characters without splitting escapes', () => {
  expect(smsMetrics('a'.repeat(160)).segments).toBe(1);
  expect(smsMetrics('a'.repeat(161)).segments).toBe(2);
  expect(smsMetrics('a'.repeat(306)).segments).toBe(2);
  expect(smsMetrics('a'.repeat(307)).segments).toBe(3);
  expect(smsMetrics('^'.repeat(80)).segments).toBe(1);
  expect(smsMetrics('^'.repeat(153)).segments).toBe(3);
  expect(gsmUnits('^{}\\[~]|€')).toBe(18);
  expect(gsmUnits('é£Δ')).toBe(3);
 });
 it('preserves inbound Unicode and counts UTF-16 including surrogate pairs', () => {
  expect(smsMetrics('中'.repeat(70))).toMatchObject({encoding:'UTF-16',segments:1});
  expect(smsMetrics('中'.repeat(71)).segments).toBe(2);
  expect(smsMetrics('😀'.repeat(35)).segments).toBe(1);
  expect(smsMetrics('😀'.repeat(67)).segments).toBe(3);
 });
 it('normalizes smart punctuation, accents, no-break spaces and decorative symbols idempotently', () => {
  const body = '“Hi” — we’ll see Zoë\u00a0at 5… 😀 Reply STOP.';
  const prepared = prepareSms(body);
  expect(prepared.body).toBe('"Hi" - we\'ll see Zoe at 5... Reply STOP.');
  expect(gsmUnits(prepared.body)).not.toBeNull();
  expect(prepareSms(prepared.body)).toEqual(prepared);
  expect(normalizeSms('e\u0301').text).toBe('é');
 });
 it('never sends an empty result, erases substantive script, or truncates consent to meet a limit', () => {
  expect(()=>prepareSms('😀')).toThrow('empty');
  expect(()=>prepareSms('Meet 李 at 5')).toThrow('unsupported');
  expect(()=>prepareSms('a'.repeat(1531))).toThrow('10 GSM-7');
  expect(prepareSms('a'.repeat(1514)+' Reply STOP.').body).toContain('Reply STOP.');
 });
});
