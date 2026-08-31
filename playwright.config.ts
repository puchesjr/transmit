import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

if (existsSync('.env')) {
	process.loadEnvFile('.env');
}

const databaseUrl =
	process.env.DATABASE_URL ?? 'postgres://transmit:transmit@127.0.0.1:5432/transmit';

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.ts',
	fullyParallel: false,
	timeout: 60_000,
	use: {
		baseURL: 'http://127.0.0.1:4173',
		screenshot: 'only-on-failure'
	},
	webServer: {
		command: 'pnpm migrate && pnpm dev --host 127.0.0.1 --port 4173 --strictPort',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			...process.env,
			DATABASE_URL: databaseUrl,
			COOKIE_SECURE: 'false',
			MESSAGING_PROVIDER: 'fake'
		}
	}
});
