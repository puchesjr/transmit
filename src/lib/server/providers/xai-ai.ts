import type { AiFollowUpContent, AiReplyContent, AiSummaryContent } from '$lib/types';
import type {
	AiConversationContext,
	AiFollowUpContext,
	AiProvider,
	AiUsageObserver
} from './ai';
import {
	AI_SYSTEM_PROMPT,
	FOLLOW_UP_OUTPUT,
	REPLY_OUTPUT,
	SUMMARY_OUTPUT,
	followUpPrompt,
	parseFollowUp,
	parseReply,
	parseSummary,
	replyPrompt,
	summaryPrompt,
	type StructuredAiOutput
} from './structured-ai';

const API_URL = 'https://api.x.ai/v1/responses';
const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

type XaiResponse = {
	output?: {
		type?: string;
		content?: { type?: string; text?: string }[];
	}[];
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		input_tokens_details?: { cached_tokens?: number };
		output_tokens_details?: { reasoning_tokens?: number };
	};
};

function reasoningEffort(): ReasoningEffort {
	const configured = process.env.XAI_REASONING_EFFORT?.trim() || 'low';
	if (!REASONING_EFFORTS.includes(configured as ReasoningEffort)) {
		throw new Error(`Unsupported XAI_REASONING_EFFORT: ${configured}`);
	}
	return configured as ReasoningEffort;
}

function enabled(value: string | undefined): boolean {
	return value?.trim().toLowerCase() === 'true';
}

export class XaiAiProvider implements AiProvider {
	readonly name = 'xai' as const;
	readonly model: string;
	readonly reasoningEffort: ReasoningEffort;
	private readonly apiKey: string;
	private readonly onUsage?: AiUsageObserver;
	private readonly requireZeroDataRetention: boolean;

	constructor(options: { onUsage?: AiUsageObserver } = {}) {
		this.apiKey = process.env.XAI_API_KEY ?? '';
		if (!this.apiKey) throw new Error('XAI_API_KEY is not set');
		if (process.env.NODE_ENV === 'production' && !enabled(process.env.XAI_ZDR_CONFIRMED)) {
			throw new Error('XAI_ZDR_CONFIRMED must be true before production AI traffic');
		}
		this.model = process.env.XAI_MODEL ?? 'grok-4.6';
		this.reasoningEffort = reasoningEffort();
		this.requireZeroDataRetention =
			process.env.NODE_ENV === 'production' || enabled(process.env.XAI_REQUIRE_ZDR);
		this.onUsage = options.onUsage;
	}

	private async generate(prompt: string, output: StructuredAiOutput): Promise<unknown> {
		const response = await fetch(API_URL, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${this.apiKey}`
			},
			body: JSON.stringify({
				model: this.model,
				store: false,
				max_output_tokens: 900,
				reasoning: { effort: this.reasoningEffort },
				input: [
					{ role: 'system', content: AI_SYSTEM_PROMPT },
					{ role: 'user', content: prompt }
				],
				text: {
					format: {
						type: 'json_schema',
						name: output.name,
						schema: output.schema,
						strict: true
					}
				}
			}),
			signal: AbortSignal.timeout(30_000)
		});
		if (!response.ok) throw new Error(`xAI request failed (${response.status})`);
		if (
			this.requireZeroDataRetention &&
			response.headers.get('x-zero-data-retention') !== 'true'
		) {
			throw new Error('xAI Zero Data Retention is not active');
		}
		const payload = (await response.json()) as XaiResponse;
		const message = payload.output?.find((item) => item.type === 'message');
		const block = message?.content?.find((item) => item.type === 'output_text');
		if (!block?.text) throw new Error('xAI returned no structured output');
		this.onUsage?.({
			provider: this.name,
			model: this.model,
			inputTokens: payload.usage?.input_tokens ?? 0,
			cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens ?? 0,
			outputTokens: payload.usage?.output_tokens ?? 0,
			reasoningTokens: payload.usage?.output_tokens_details?.reasoning_tokens ?? 0
		});
		return JSON.parse(block.text) as unknown;
	}

	async suggestReplies(context: AiConversationContext): Promise<AiReplyContent> {
		return parseReply(await this.generate(replyPrompt(context), REPLY_OUTPUT));
	}

	async summarizeConversation(context: AiConversationContext): Promise<AiSummaryContent> {
		return parseSummary(await this.generate(summaryPrompt(context), SUMMARY_OUTPUT));
	}

	async draftFollowUp(context: AiFollowUpContext): Promise<AiFollowUpContent> {
		return parseFollowUp(await this.generate(followUpPrompt(context), FOLLOW_UP_OUTPUT));
	}
}
