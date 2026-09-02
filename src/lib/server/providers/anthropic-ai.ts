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

const API_URL = 'https://api.anthropic.com/v1/messages';

type AnthropicResponse = {
	content?: { type?: string; text?: string }[];
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		cache_read_input_tokens?: number;
	};
};

export class AnthropicAiProvider implements AiProvider {
	readonly name = 'anthropic' as const;
	readonly model: string;
	private readonly apiKey: string;
	private readonly onUsage?: AiUsageObserver;

	constructor(options: { onUsage?: AiUsageObserver } = {}) {
		this.apiKey = process.env.ANTHROPIC_API_KEY ?? '';
		if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
		this.model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
		this.onUsage = options.onUsage;
	}

	private async generate(prompt: string, output: StructuredAiOutput): Promise<unknown> {
		const response = await fetch(API_URL, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'anthropic-version': '2023-06-01',
				'x-api-key': this.apiKey
			},
			body: JSON.stringify({
				model: this.model,
				max_tokens: 900,
				system: AI_SYSTEM_PROMPT,
				messages: [{ role: 'user', content: prompt }],
				output_config: { format: { type: 'json_schema', schema: output.schema } }
			}),
			signal: AbortSignal.timeout(30_000)
		});
		if (!response.ok) throw new Error(`Anthropic request failed (${response.status})`);
		const payload = (await response.json()) as AnthropicResponse;
		const block = payload.content?.find((item) => item.type === 'text');
		if (!block?.text) throw new Error('Anthropic returned no structured output');
		this.onUsage?.({
			provider: this.name,
			model: this.model,
			inputTokens: payload.usage?.input_tokens ?? 0,
			cachedInputTokens: payload.usage?.cache_read_input_tokens ?? 0,
			outputTokens: payload.usage?.output_tokens ?? 0,
			reasoningTokens: 0
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
