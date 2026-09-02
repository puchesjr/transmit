import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { AnthropicAiProvider } from '../src/lib/server/providers/anthropic-ai';
import type {
	AiConversationContext,
	AiFollowUpContext,
	AiProvider,
	AiProviderUsage
} from '../src/lib/server/providers/ai';
import { XaiAiProvider } from '../src/lib/server/providers/xai-ai';

if (existsSync('.env')) process.loadEnvFile('.env');

type Fixture = {
	name: string;
	context: AiConversationContext;
	followUp: Pick<AiFollowUpContext, 'opportunityName' | 'stageName' | 'idleDays'>;
	expectedUrgency: 'low' | 'medium' | 'high';
};

const fixtures: Fixture[] = [
	{
		name: 'urgent leak',
		context: {
			customerFirstName: 'Jamie',
			locationName: 'Northstar Home Services',
			messages: [
				{
					direction: 'customer',
					body: 'Our water heater is leaking into the garage. Can someone help today?',
					sentAt: '2026-09-01T14:00:00.000Z'
				}
			]
		},
		followUp: { opportunityName: 'Water heater service', stageName: 'New lead', idleDays: 1 },
		expectedUrgency: 'high'
	},
	{
		name: 'estimate request',
		context: {
			customerFirstName: 'Morgan',
			locationName: 'Northstar Home Services',
			messages: [
				{
					direction: 'customer',
					body: 'I would like an estimate to replace two bathroom faucets.',
					sentAt: '2026-09-01T15:00:00.000Z'
				}
			]
		},
		followUp: { opportunityName: 'Bathroom faucet estimate', stageName: 'Qualified', idleDays: 3 },
		expectedUrgency: 'medium'
	},
	{
		name: 'appointment preference',
		context: {
			customerFirstName: 'Taylor',
			locationName: 'Northstar Home Services',
			messages: [
				{
					direction: 'customer',
					body: 'Do you have any openings next Tuesday afternoon for an AC tune-up?',
					sentAt: '2026-09-01T16:00:00.000Z'
				}
			]
		},
		followUp: { opportunityName: 'AC tune-up', stageName: 'Qualified', idleDays: 2 },
		expectedUrgency: 'medium'
	}
];

const forbiddenClaim = /\b(?:appointment|service) (?:is )?(?:booked|confirmed)\b|\bscheduled for\b|\$\d/i;
const showOutputs = process.env.AI_EVAL_SHOW_OUTPUTS === 'true';

function percentile95(values: number[]): number {
	const ordered = [...values].sort((a, b) => a - b);
	return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
}

function estimatedCost(
	provider: 'xai' | 'anthropic',
	model: string,
	usage: AiProviderUsage[]
): number | null {
	const prices = provider === 'xai' && model === 'grok-4.6'
		? { input: 2, cached: 0.5, output: 6 }
		: provider === 'anthropic' && model === 'claude-sonnet-5'
			? { input: 2, cached: 0.2, output: 10 }
			: null;
	if (!prices) return null;
	return usage.reduce((total, item) => {
		const cached = Math.min(item.inputTokens, item.cachedInputTokens);
		const uncached = item.inputTokens - cached;
		return total + (uncached * prices.input + cached * prices.cached + item.outputTokens * prices.output) / 1_000_000;
	}, 0);
}

async function evaluate(
	name: 'xai' | 'anthropic',
	create: (onUsage: (usage: AiProviderUsage) => void) => AiProvider
) {
	const usage: AiProviderUsage[] = [];
	const provider = create((item) => usage.push(item));
	const durations: number[] = [];
	const checks: { fixture: string; passed: boolean; issues: string[]; outputs?: unknown }[] = [];

	for (const fixture of fixtures) {
		const started = performance.now();
		const reply = await provider.suggestReplies(fixture.context);
		const summary = await provider.summarizeConversation(fixture.context);
		const followUp = await provider.draftFollowUp({ ...fixture.context, ...fixture.followUp });
		durations.push(performance.now() - started);

		const issues: string[] = [];
		if (reply.urgency !== fixture.expectedUrgency) issues.push(`reply urgency was ${reply.urgency}`);
		if (summary.urgency !== fixture.expectedUrgency) issues.push(`summary urgency was ${summary.urgency}`);
		if (new Set(reply.choices.map((choice) => choice.body)).size !== 3) issues.push('reply choices were not distinct');
		if (reply.choices.some((choice) => choice.body.length > 320)) issues.push('reply exceeded 320 characters');
		if ([...reply.choices.map((choice) => choice.body), followUp.body].some((body) => forbiddenClaim.test(body))) {
			issues.push('draft made an unsupported price or booking claim');
		}
		checks.push({
			fixture: fixture.name,
			passed: issues.length === 0,
			issues,
			...(showOutputs ? { outputs: { reply, summary, followUp } } : {})
		});
	}

	const totals = usage.reduce(
		(acc, item) => ({
			inputTokens: acc.inputTokens + item.inputTokens,
			cachedInputTokens: acc.cachedInputTokens + item.cachedInputTokens,
			outputTokens: acc.outputTokens + item.outputTokens,
			reasoningTokens: acc.reasoningTokens + item.reasoningTokens
		}),
		{ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }
	);

	const cost = estimatedCost(name, provider.model, usage);
	return {
		provider: name,
		model: provider.model,
		fixturesPassed: checks.filter((item) => item.passed).length,
		fixturesTotal: checks.length,
		averageFixtureMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
		p95FixtureMs: Math.round(percentile95(durations)),
		usage: totals,
		estimatedListCostUsd: cost === null ? null : Number(cost.toFixed(6)),
		checks
	};
}

const requested = (process.env.AI_EVAL_PROVIDERS ?? 'xai,anthropic')
	.split(',')
	.map((value) => value.trim())
	.filter(Boolean);
const results: unknown[] = [];

for (const name of requested) {
	if (name === 'xai') {
		if (!process.env.XAI_API_KEY) throw new Error('XAI_API_KEY is required to evaluate xAI');
		results.push(await evaluate('xai', (onUsage) => new XaiAiProvider({ onUsage })));
	} else if (name === 'anthropic') {
		if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required to evaluate Anthropic');
		results.push(await evaluate('anthropic', (onUsage) => new AnthropicAiProvider({ onUsage })));
	} else {
		throw new Error(`Unsupported AI evaluation provider: ${name}`);
	}
}

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), syntheticFixtures: true, results }, null, 2));
