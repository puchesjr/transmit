import type { AiConciergeContent, AiReplyContent, AiUrgency } from '$lib/types';
import type {
	AiConciergeContext,
	AiConversationContext,
	AiFollowUpContext,
	AiProvider
} from './ai';

function lastCustomerMessage(context: AiConversationContext): string {
	return [...context.messages].reverse().find((message) => message.direction === 'customer')?.body ?? '';
}

function analyze(text: string): { intent: string; urgency: AiUrgency; nextAction: string } {
	const normalized = text.toLowerCase();
	const urgent = /\b(emergency|urgent|asap|flood|leak(?:ing)?|no heat|no air|stopped working|getting hot|burst|smoke)\b/.test(normalized);
	const intent = /\b(price|cost|quote|estimate)\b/.test(normalized)
		? 'Requesting an estimate'
		: /\b(when|schedule|appointment|available)\b/.test(normalized)
			? 'Trying to schedule service'
			: 'Requesting service help';
	return {
		intent,
		urgency: urgent ? 'high' : 'medium',
		nextAction: urgent
			? 'Confirm the address and whether the situation is safe.'
			: 'Confirm the service address and the best time to help.'
	};
}

function greeting(firstName: string): string {
	return firstName ? `Hi ${firstName}` : 'Hi there';
}

export class FakeAiProvider implements AiProvider {
	readonly name = 'fake' as const;
	readonly model = 'deterministic-phase-5';

	async suggestReplies(context: AiConversationContext): Promise<AiReplyContent> {
		const analysis = analyze(lastCustomerMessage(context));
		return {
			...analysis,
			choices: [
				{
					label: 'Fast' as const,
					body: `${greeting(context.customerFirstName)} — thanks for reaching out. We can help. What is the service address?`,
					rationale: 'Acknowledges the lead immediately and asks for the first routing detail.'
				},
				{
					label: 'Warm' as const,
					body: `${greeting(context.customerFirstName)} — I’m glad you reached out. We’ll help you figure out the right next step. Can you share the service address and what is happening?`,
					rationale: 'Adds reassurance while keeping the response concise and useful.'
				},
				{
					label: 'Qualify' as const,
					body: `${greeting(context.customerFirstName)} — thanks for contacting us. What service do you need, where is the property, and how soon do you need help?`,
					rationale: 'Collects the minimum details needed to route and prioritize the lead.'
				}
			]
		};
	}

	async summarizeConversation(context: AiConversationContext) {
		const latest = lastCustomerMessage(context);
		const analysis = analyze(latest);
		return {
			summary: latest
				? `The customer’s latest request is: ${latest.slice(0, 240)}`
				: 'No customer request has been received yet.',
			...analysis,
			facts: [`${context.messages.length} message${context.messages.length === 1 ? '' : 's'} in the conversation`]
		};
	}

	async draftFollowUp(context: AiFollowUpContext) {
		const analysis = analyze(lastCustomerMessage(context));
		return {
			body: `${greeting(context.customerFirstName)} — just checking in about ${context.opportunityName}. Would you like us to help with the next step?`,
			rationale: `This lead has been idle in ${context.stageName} for ${context.idleDays} days.`,
			urgency: analysis.urgency,
			nextAction: 'Review the draft, personalize it if needed, and send it from the conversation.'
		};
	}

	async continueConcierge(context: AiConciergeContext): Promise<AiConciergeContent> {
		const latest = lastCustomerMessage(context).trim();
		const normalized = latest.toLowerCase();
		if (/\b(human|person|someone|representative|call me)\b/.test(normalized)) {
			return {
				reply: 'I’ll bring in a person from the team. They can continue here or by text.',
				serviceAddress: context.qualification.serviceAddress,
				issueSummary: context.qualification.issueSummary,
				urgency: context.qualification.urgency,
				action: 'handoff',
				handoffReason: 'The visitor asked for a person'
			};
		}
		if (/\b(gas leak|smoke|fire|sparks|medical emergency)\b/.test(normalized)) {
			return {
				reply:
					'This may be a safety emergency. Please move to a safe place and contact emergency services if needed. I’m alerting the team now.',
				serviceAddress: context.qualification.serviceAddress,
				issueSummary: latest.slice(0, 500),
				urgency: 'high',
				action: 'handoff',
				handoffReason: 'Potential safety emergency'
			};
		}
		if (/\b(refund|invoice|billing|warranty claim|legal)\b/.test(normalized)) {
			return {
				reply: 'That request needs a person from the team. I’ll hand this conversation over now.',
				serviceAddress: context.qualification.serviceAddress,
				issueSummary: latest.slice(0, 500),
				urgency: 'medium',
				action: 'handoff',
				handoffReason: 'Request is outside appointment-booking scope'
			};
		}

		const addressMatch = latest.match(
			/\b\d{1,6}\s+[A-Za-z0-9.' -]{2,80}\s(?:st(?:reet)?|rd|road|ave(?:nue)?|blvd|drive|dr|lane|ln|court|ct|way|parkway|pkwy)\b(?:[^.!?\n]{0,80})?/i
		);
		const serviceAddress = context.qualification.serviceAddress ?? addressMatch?.[0]?.trim() ?? null;
		const issueSummary = context.qualification.issueSummary ?? (latest ? latest.slice(0, 500) : null);
		const analysis = analyze(latest);
		if (!serviceAddress) {
			return {
				reply: `Thanks — what is the street address for the ${context.serviceName.toLowerCase()} visit?`,
				serviceAddress: null,
				issueSummary,
				urgency: analysis.urgency,
				action: 'ask',
				handoffReason: null
			};
		}
		return {
			reply: 'Thanks — I have what I need to check the live schedule.',
			serviceAddress,
			issueSummary,
			urgency: analysis.urgency,
			action: 'offer_availability',
			handoffReason: null
		};
	}
}
