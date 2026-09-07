import type { OnboardingStatus } from '$lib/types';

export function workspaceHome(status: OnboardingStatus): '/onboarding' | '/inbox' {
	return status === 'pending' ? '/onboarding' : '/inbox';
}
