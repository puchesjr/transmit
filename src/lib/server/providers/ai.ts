import type {
	AiFollowUpContent,
	AiReplyContent,
	AiSummaryContent
} from '$lib/types';

export type AiMessageContext = {
	direction: 'customer' | 'business';
	body: string;
	sentAt: string;
};

export type AiConversationContext = {
	customerFirstName: string;
	locationName: string;
	messages: AiMessageContext[];
};

export type AiFollowUpContext = AiConversationContext & {
	opportunityName: string;
	stageName: string;
	idleDays: number;
};

export type AiProviderName = 'xai' | 'anthropic' | 'fake';

export type AiProviderUsage = {
	provider: Exclude<AiProviderName, 'fake'>;
	model: string;
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	reasoningTokens: number;
};

export type AiUsageObserver = (usage: AiProviderUsage) => void;

/**
 * Provider boundary for generated customer communication. Providers only
 * return drafts and analysis; sending remains in the messaging domain.
 */
export interface AiProvider {
	readonly name: AiProviderName;
	readonly model: string;
	suggestReplies(context: AiConversationContext): Promise<AiReplyContent>;
	summarizeConversation(context: AiConversationContext): Promise<AiSummaryContent>;
	draftFollowUp(context: AiFollowUpContext): Promise<AiFollowUpContent>;
}

let provider: AiProvider | undefined;

export async function getAiProvider(): Promise<AiProvider> {
	if (!provider) {
		const configured = process.env.AI_PROVIDER?.trim();
		const selected = configured ||
			(process.env.XAI_API_KEY ? 'xai' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'fake');
		if (selected === 'fake') {
			// AI is optional in production, but only by saying so. A missing key must
			// not quietly downgrade every customer to canned drafts.
			if (process.env.NODE_ENV === 'production' && configured !== 'fake') {
				throw new Error(
					'No AI provider is configured for production. Set XAI_API_KEY or ANTHROPIC_API_KEY, or AI_PROVIDER=fake to run without AI drafting.'
				);
			}
			const { FakeAiProvider } = await import('./fake-ai');
			provider = new FakeAiProvider();
		} else if (selected === 'xai') {
			const { XaiAiProvider } = await import('./xai-ai');
			provider = new XaiAiProvider();
		} else if (selected === 'anthropic') {
			const { AnthropicAiProvider } = await import('./anthropic-ai');
			provider = new AnthropicAiProvider();
		} else {
			throw new Error(`Unsupported AI_PROVIDER: ${selected}`);
		}
	}
	return provider!;
}

export function setAiProvider(override: AiProvider | undefined): void {
	provider = override;
}
