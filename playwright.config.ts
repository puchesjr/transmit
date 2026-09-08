import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

if (existsSync('.env')) {
	process.loadEnvFile('.env');
}

// Never share an outbox with a developer's live-provider worker.
const testDatabaseUrl = new URL(
	process.env.DATABASE_URL || 'postgres://transmit:transmit@127.0.0.1:5432/transmit'
);
testDatabaseUrl.pathname += '_e2e';
const databaseUrl = process.env.E2E_DATABASE_URL || testDatabaseUrl.toString();

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.ts',
	fullyParallel: false,
	workers: 1,
	timeout: 120_000,
	use: {
		baseURL: 'http://127.0.0.1:4173',
		screenshot: 'only-on-failure'
	},
	webServer: {
		command: 'pnpm migrate && pnpm dev --host 127.0.0.1 --port 4173 --strictPort',
		port: 4173,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			...process.env,
			DATABASE_URL: databaseUrl,
			COOKIE_SECURE: 'false',
			MESSAGING_PROVIDER: 'fake',
			VOICE_PROVIDER: 'fake',
			BILLING_PROVIDER: 'fake',
			AI_PROVIDER: 'fake',
			SCHEDULER_PROVIDER: 'fake',
			OUTBOUND_WEBHOOK_PROVIDER: 'fake'
		}
	}
});
