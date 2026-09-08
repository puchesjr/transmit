import { expect, it, vi } from 'vitest';
import * as ai from '$lib/server/providers/ai';
import { getSql } from '$lib/server/db';
import { enqueue } from '$lib/server/outbox';
import { drainOnce } from '$lib/server/worker';

it('processes non-AI jobs when the AI provider is unavailable', async () => {
	const unavailable = vi.spyOn(ai, 'getAiProvider').mockRejectedValue(new Error('AI is not configured'));
	try {
		await enqueue(getSql(), { kind: 'booking.session.timeout', accountId: null, payload: {} });
		await expect(drainOnce()).resolves.toBe(1);
		expect(unavailable).not.toHaveBeenCalled();
	} finally { unavailable.mockRestore(); }
});
