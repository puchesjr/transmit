import { emailProviderConfigured } from '$lib/server/providers/email';

export const load = () => ({ available: emailProviderConfigured() });
