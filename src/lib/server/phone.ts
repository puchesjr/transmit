export function normalizeE164(phone: string): string {
	const digits = phone.replace(/\D/g, '');
	if (phone.startsWith('+')) return `+${digits}`;
	if (digits.length === 10) return `+1${digits}`;
	if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
	return `+${digits}`;
}

export function isUsE164(phone: string): boolean {
	return /^\+1\d{10}$/.test(phone);
}

const TOLL_FREE_NPAS = new Set(['800', '888', '877', '866', '855', '844', '833', '822']);

export function isUsTollFree(phone: string): boolean {
	return isUsE164(phone) && TOLL_FREE_NPAS.has(phone.slice(2, 5));
}
