import { afterEach, describe, expect, test, vi } from 'vitest';
import { getAiProvider, setAiProvider, type AiProviderUsage } from '$lib/server/providers/ai';
import { AnthropicAiProvider } from '$lib/server/providers/anthropic-ai';
import { XaiAiProvider } from '$lib/server/providers/xai-ai';

const context = {
	customerFirstName: 'Jamie',
	locationName: 'Northstar Home Services',
	messages: [
		{
			direction: 'customer' as const,
			body: 'My water heater is leaking. Can someone help today?',
			sentAt: '2026-09-01T14:00:00.000Z'
		}
	]
};

const reply = {
	intent: 'Emergency water heater service',
	urgency: 'high',
	nextAction: 'Confirm the service address and whether the leak is contained.',
	choices: [
		{
			label: 'Fast',
			body: 'Hi Jamie — we can help. What is the service address, and is the leak contained?',
			rationale: 'Responds immediately and checks safety.'
		},
		{
			label: 'Warm',
			body: 'Hi Jamie — I’m sorry you’re dealing with that. Please send the service address and let us know whether the leak is contained.',
			rationale: 'Adds empathy and gathers the next details.'
		},
		{
			label: 'Qualify',
			body: 'Hi Jamie — what is the service address, where is the heater leaking from, and can you safely shut off its water supply?',
			rationale: 'Collects routing and safety information.'
		}
	]
};

const summary = {
	summary: 'Jamie reported a leaking water heater and asked for help today.',
	intent: 'Emergency water heater service',
	urgency: 'high',
	nextAction: 'Confirm the service address and whether the leak is contained.',
	facts: ['The water heater is leaking.', 'Jamie asked whether someone can help today.']
};

const followUp = {
	body: 'Hi Jamie — are you still looking for help with the water heater?',
	rationale: 'Checks in without claiming an appointment or completed action.',
	urgency: 'high',
	nextAction: 'Review and send if service is still needed.'
};

function xaiResponse(value: unknown, zeroDataRetention = true): Response {
	return new Response(
		JSON.stringify({
			output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
			usage: {
				input_tokens: 500,
				output_tokens: 180,
				input_tokens_details: { cached_tokens: 100 },
				output_tokens_details: { reasoning_tokens: 40 }
			}
		}),
		{
			status: 200,
			headers: { 'content-type': 'application/json', 'x-zero-data-retention': String(zeroDataRetention) }
		}
	);
}

afterEach(() => {
	setAiProvider(undefined);
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('xAI adapter', () => {
	test('requests low-reasoning stateless structured output and reports usage', async () => {
		vi.stubEnv('NODE_ENV', 'test');
		vi.stubEnv('XAI_API_KEY', 'xai-test-key');
		vi.stubEnv('XAI_MODEL', 'grok-4.6');
		vi.stubEnv('XAI_REASONING_EFFORT', 'low');
		vi.stubEnv('XAI_REQUIRE_ZDR', 'true');
		const usage: AiProviderUsage[] = [];
		const fetchMock = vi.fn().mockResolvedValue(xaiResponse(reply));
		vi.stubGlobal('fetch', fetchMock);

		const provider = new XaiAiProvider({ onUsage: (item) => usage.push(item) });
		const result = await provider.suggestReplies(context);

		expect(result).toEqual(reply);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(String(request.body));
		expect(url).toBe('https://api.x.ai/v1/responses');
		expect(request.headers).toMatchObject({ authorization: 'Bearer xai-test-key' });
		expect(body).toMatchObject({
			model: 'grok-4.6',
			store: false,
			max_output_tokens: 900,
			reasoning: { effort: 'low' },
			text: { format: { type: 'json_schema', name: 'kiso_reply_choices', strict: true } }
		});
		expect(body.input[0].role).toBe('system');
		expect(body.input[1].content).toContain('untrusted_customer_conversation');
		expect(body.text.format.schema.additionalProperties).toBe(false);
		expect(usage).toEqual([
			{
				provider: 'xai',
				model: 'grok-4.6',
				inputTokens: 500,
				cachedInputTokens: 100,
				outputTokens: 180,
				reasoningTokens: 40
			}
		]);
	});

	test('fails closed when Zero Data Retention is required but inactive', async () => {
		vi.stubEnv('NODE_ENV', 'test');
		vi.stubEnv('XAI_API_KEY', 'xai-test-key');
		vi.stubEnv('XAI_REQUIRE_ZDR', 'true');
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xaiResponse(reply, false)));

		await expect(new XaiAiProvider().suggestReplies(context)).rejects.toThrow(
			'xAI Zero Data Retention is not active'
		);
	});

	test('uses the shared summary and follow-up contracts', async () => {
		vi.stubEnv('NODE_ENV', 'test');
		vi.stubEnv('XAI_API_KEY', 'xai-test-key');
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(xaiResponse(summary))
			.mockResolvedValueOnce(xaiResponse(followUp));
		vi.stubGlobal('fetch', fetchMock);
		const provider = new XaiAiProvider();

		await expect(provider.summarizeConversation(context)).resolves.toEqual(summary);
		await expect(
			provider.draftFollowUp({
				...context,
				opportunityName: 'Water heater service',
				stageName: 'New lead',
				idleDays: 1
			})
		).resolves.toEqual(followUp);
		const requestBodies = fetchMock.mock.calls.map(([, request]) =>
			JSON.parse(String((request as RequestInit).body))
		);
		expect(requestBodies.map((body) => body.text.format.name)).toEqual([
			'kiso_conversation_summary',
			'kiso_follow_up'
		]);
	});

	test('requires an explicit ZDR confirmation before production traffic', () => {
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('XAI_API_KEY', 'xai-test-key');
		vi.stubEnv('XAI_ZDR_CONFIRMED', 'false');

		expect(() => new XaiAiProvider()).toThrow(
			'XAI_ZDR_CONFIRMED must be true before production AI traffic'
		);
	});

	test('rejects unsupported reasoning configuration before making a request', () => {
		vi.stubEnv('NODE_ENV', 'test');
		vi.stubEnv('XAI_API_KEY', 'xai-test-key');
		vi.stubEnv('XAI_REASONING_EFFORT', 'none');

		expect(() => new XaiAiProvider()).toThrow('Unsupported XAI_REASONING_EFFORT: none');
	});
});

describe('AI provider selection', () => {
	test('prefers xAI when both live keys exist and no provider is forced', async () => {
		vi.stubEnv('NODE_ENV', 'test');
		vi.stubEnv('AI_PROVIDER', '');
		vi.stubEnv('XAI_API_KEY', 'xai-test-key');
		vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-test-key');

		await expect(getAiProvider()).resolves.toMatchObject({ name: 'xai', model: 'grok-4.6' });
	});

	test('keeps Anthropic explicitly selectable without automatic cross-vendor fallback', async () => {
		vi.stubEnv('AI_PROVIDER', 'anthropic');
		vi.stubEnv('XAI_API_KEY', 'xai-test-key');
		vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-test-key');

		await expect(getAiProvider()).resolves.toMatchObject({ name: 'anthropic', model: 'claude-sonnet-5' });
	});

	test('uses deterministic drafts when no live provider is configured', async () => {
		vi.stubEnv('AI_PROVIDER', '');
		vi.stubEnv('XAI_API_KEY', '');
		vi.stubEnv('ANTHROPIC_API_KEY', '');

		await expect(getAiProvider()).resolves.toMatchObject({ name: 'fake' });
	});

	test('rejects an unknown provider instead of silently routing customer data elsewhere', async () => {
		vi.stubEnv('AI_PROVIDER', 'unknown');

		await expect(getAiProvider()).rejects.toThrow('Unsupported AI_PROVIDER: unknown');
	});
});

test('Anthropic uses the same guarded structured response contract', async () => {
	vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-test-key');
	const fetchMock = vi.fn().mockResolvedValue(
		new Response(
			JSON.stringify({
				content: [{ type: 'text', text: JSON.stringify(reply) }],
				usage: { input_tokens: 450, output_tokens: 160, cache_read_input_tokens: 80 }
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		)
	);
	vi.stubGlobal('fetch', fetchMock);
	const usage: AiProviderUsage[] = [];

	const result = await new AnthropicAiProvider({ onUsage: (item) => usage.push(item) }).suggestReplies(context);
	const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
	const body = JSON.parse(String(request.body));

	expect(result).toEqual(reply);
	expect(body.system).toContain('human reviews and sends every message');
	expect(body.output_config.format).toMatchObject({ type: 'json_schema' });
	expect(body.output_config.format.schema.additionalProperties).toBe(false);
	expect(usage).toEqual([
		{
			provider: 'anthropic',
			model: 'claude-sonnet-5',
			inputTokens: 450,
			cachedInputTokens: 80,
			outputTokens: 160,
			reasoningTokens: 0
		}
	]);
});
