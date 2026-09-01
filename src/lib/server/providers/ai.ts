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

/**
 * Provider boundary for generated customer communication. Providers only
 * return drafts and analysis; sending remains in the messaging domain.
 */
export interface AiProvider {
	readonly name: 'anthropic' | 'fake';
	readonly model: string;
	suggestReplies(context: AiConversationContext): Promise<AiReplyContent>;
	summarizeConversation(context: AiConversationContext): Promise<AiSummaryContent>;
	draftFollowUp(context: AiFollowUpContext): Promise<AiFollowUpContent>;
}

let provider: AiProvider | undefined;

export async function getAiProvider(): Promise<AiProvider> {
	if (!provider) {
		const forced = process.env.AI_PROVIDER;
		if (forced === 'fake' || (!process.env.ANTHROPIC_API_KEY && forced !== 'anthropic')) {
			const { FakeAiProvider } = await import('./fake-ai');
			provider = new FakeAiProvider();
		} else {
			const { AnthropicAiProvider } = await import('./anthropic-ai');
			provider = new AnthropicAiProvider();
		}
	}
	return provider!;
}

export function setAiProvider(override: AiProvider | undefined): void {
	provider = override;
}
