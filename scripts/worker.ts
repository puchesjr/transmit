import { existsSync } from 'node:fs';
import { log } from '../src/lib/server/logger';
import { drainOnce } from '../src/lib/server/worker';

if (existsSync('.env')) {
	process.loadEnvFile('.env');
}

log('info', 'worker_started', {});

const INTERVAL_MS = 1000;

async function loop(): Promise<never> {
	// Deliberately sequential: drain fully, then wait.
	for (;;) {
		const processed = await drainOnce().catch(() => 0);
		await new Promise((resolve) => setTimeout(resolve, processed > 0 ? 50 : INTERVAL_MS));
	}
}

await loop();
