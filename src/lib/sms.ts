/** GSM 03.38 codec helpers shared by the preview and server. No sending policy here. */
const BASIC = new Set(Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'));
const EXTENDED = new Set(Array.from('\f^{}\\[~]|€'));
const REPLACEMENTS: Record<string, string> = {
	'‘': "'", '’': "'", '‚': "'", '‛': "'", '“': '"', '”': '"', '„': '"',
	'–': '-', '—': '-', '‑': '-', '−': '-', '…': '...', '\u00a0': ' ', '\t': ' ',
	'•': '-', '·': '-', '™': '(TM)', '®': '(R)', '©': '(C)', 'œ': 'oe', 'Œ': 'OE',
	'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'Th'
};
export function gsmUnits(text: string): number | null {
	let units = 0;
	for (const char of text) {
		if (BASIC.has(char)) units += 1;
		else if (EXTENDED.has(char)) units += 2;
		else return null;
	}
	return units;
}
export function smsMetrics(text: string): { encoding: 'GSM-7' | 'UTF-16'; units: number; segments: number } {
	const gsm = gsmUnits(text);
	const units = gsm ?? text.length;
	const single = gsm == null ? 70 : 160;
	const capacity = gsm == null ? 67 : 153;
	let segments = units === 0 ? 0 : 1;
	if (units > single) {
		let used = 0;
		for (const char of text) {
			const width = gsm == null ? char.length : EXTENDED.has(char) ? 2 : 1;
			if (used + width > capacity) { segments++; used = 0; }
			used += width;
		}
	}
	return { encoding: gsm == null ? 'UTF-16' : 'GSM-7', units, segments };
}
export function normalizeSms(text: string): { text: string; changed: boolean; unsupportedText: boolean } {
	let result = '';
	let unsupportedText = false;
	for (const char of text.normalize('NFC')) {
		if (BASIC.has(char) || EXTENDED.has(char)) { result += char; continue; }
		if (REPLACEMENTS[char] != null) { result += REPLACEMENTS[char]; continue; }
		const plain = char.normalize('NFKD').replace(/\p{M}/gu, '');
		if (plain && gsmUnits(plain) != null) { result += plain; continue; }
		// Never silently erase an address/name or non-Latin sentence. Emoji and
		// decorative symbols may be removed, but substantive text needs editing.
		if (/[\p{L}\p{N}]/u.test(char)) unsupportedText = true;
		if (!/[\p{M}\p{Cf}]/u.test(char)) result += ' ';
	}
	result = result.replace(/ +/g, ' ').trim();
	return { text: result, changed: result !== text, unsupportedText };
}
