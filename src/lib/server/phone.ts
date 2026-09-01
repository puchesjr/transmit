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
