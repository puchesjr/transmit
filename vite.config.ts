import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	test: {
		expect: { requireAssertions: true },
		fileParallelism: false,
		env: {
			DATABASE_URL:
				process.env.TEST_DATABASE_URL ??
				'postgres://transmit:transmit@127.0.0.1:5432/transmit_test',
			MESSAGING_PROVIDER: 'fake'
		},
		projects: [
			{
				extends: true,
				test: {
					name: 'server',
					environment: 'node',
					setupFiles: ['tests/setup.ts'],
					include: ['src/**/*.{test,spec}.{js,ts}', 'tests/**/*.test.ts'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}', 'e2e/**', '**/*.e2e.ts']
				}
			}
		]
	}
});
