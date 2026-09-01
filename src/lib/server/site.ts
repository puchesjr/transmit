const DEFAULT_SITE_URL = 'https://transmit.dev';

export function getPublicSiteUrl(): string {
	return (process.env.PUBLIC_SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, '');
}

export function getPublicAnalyticsConfig(): { scriptUrl: string | null; siteId: string | null } {
	return {
		scriptUrl: process.env.PUBLIC_ANALYTICS_SCRIPT_URL || null,
		siteId: process.env.PUBLIC_ANALYTICS_SITE_ID || null
	};
}
