export function contactName(contact: { firstName: string; lastName: string }): string {
	const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
	return name || 'Untitled contact';
}

export function formatCents(cents: number | null): string {
	if (cents == null) return '—';
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function formatWhen(iso: string): string {
	return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
		new Date(iso)
	);
}
