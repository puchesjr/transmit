export type SessionUser = {
	id: string;
	email: string;
	name: string;
};

export type SessionAccount = {
	id: string;
	name: string;
};

export type SessionLocation = {
	id: string;
	name: string;
};

export type SessionMembership = {
	id: string;
	role: 'owner' | 'member';
};

export type MessagingConsent = 'unknown' | 'opted_in' | 'opted_out';
export type ConversationStatus = 'open' | 'waiting' | 'snoozed' | 'closed';
export type BusinessDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type BusinessDayHours = { enabled: boolean; opensAt: string; closesAt: string };
export type BusinessHours = Record<BusinessDayKey, BusinessDayHours>;
export type CallStatus = 'ringing' | 'forwarding' | 'answered' | 'missed' | 'completed' | 'failed';
export type BillingStatus = 'unconfigured' | 'trialing' | 'active' | 'past_due' | 'canceled';
export type UsageMetric = 'message_outbound' | 'message_inbound' | 'call_second';
export type AiUrgency = 'low' | 'medium' | 'high';
export type AiArtifactStatus = 'ready' | 'used' | 'dismissed' | 'stale';
export type LeadFormKind = 'service' | 'quote' | 'appointment' | 'question';
export type WebhookEventType =
	| 'contact.created'
	| 'message.received'
	| 'opportunity.stage_changed';

export type LeadForm = {
	id: string;
	locationId: string;
	kind: LeadFormKind;
	publicKey: string;
	title: string;
	intro: string;
	replyTemplate: string;
	consentText: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
};

export type PublicLeadForm = Pick<
	LeadForm,
	'kind' | 'publicKey' | 'title' | 'intro' | 'consentText'
> & {
	accountName: string;
	locationName: string;
};

export type LeadCapture = {
	id: string;
	locationId: string;
	formId: string;
	contactId: string;
	conversationId: string;
	opportunityId: string;
	sourcePage: string | null;
	referrer: string | null;
	campaign: Record<string, string>;
	requestedService: string | null;
	preferredTime: string | null;
	message: string | null;
	consentedAt: string;
	createdAt: string;
};

export type WebhookEndpoint = {
	id: string;
	url: string;
	secretHint: string;
	events: WebhookEventType[];
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
};

export type WebhookDelivery = {
	id: string;
	eventId: string;
	locationId: string;
	endpointId: string;
	eventType: WebhookEventType;
	status: 'pending' | 'delivered' | 'failed';
	attempts: number;
	responseStatus: number | null;
	lastError: string | null;
	deliveredAt: string | null;
	createdAt: string;
};

export type ContactImportResult = {
	totalRows: number;
	created: number;
	matched: number;
	skipped: number;
	errors: { row: number; message: string }[];
};

export type AiSettings = {
	enabled: boolean;
	followUpEnabled: boolean;
	followUpAfterDays: number;
};

export type AiReplyChoice = {
	label: 'Fast' | 'Warm' | 'Qualify';
	body: string;
	rationale: string;
};

export type AiReplyContent = {
	intent: string;
	urgency: AiUrgency;
	nextAction: string;
	choices: [AiReplyChoice, AiReplyChoice, AiReplyChoice];
};

export type AiSummaryContent = {
	summary: string;
	intent: string;
	urgency: AiUrgency;
	nextAction: string;
	facts: string[];
};

export type AiFollowUpContent = {
	body: string;
	rationale: string;
	urgency: AiUrgency;
	nextAction: string;
};

export type AiArtifact = {
	id: string;
	locationId: string;
	contactId: string;
	conversationId: string | null;
	opportunityId: string | null;
	kind: 'reply' | 'summary' | 'follow_up';
	status: AiArtifactStatus;
	content: AiReplyContent | AiSummaryContent | AiFollowUpContent;
	sourceLastMessageId: string | null;
	provider: string;
	model: string;
	selectedReplyIndex: number | null;
	createdAt: string;
	updatedAt: string;
};

export type Contact = {
	id: string;
	locationId: string;
	firstName: string;
	lastName: string;
	email: string | null;
	phone: string | null;
	messagingConsent: MessagingConsent;
	createdAt: string;
	updatedAt: string;
};

export type Message = {
	id: string;
	conversationId: string;
	contactId: string;
	direction: 'outbound' | 'inbound';
	body: string;
	status: 'queued' | 'sent' | 'delivered' | 'failed' | 'received';
	notBefore: string | null;
	createdAt: string;
};

export type Conversation = {
	id: string;
	locationId: string;
	contactId: string;
	status: ConversationStatus;
	assigneeUserId: string | null;
	assigneeName: string | null;
	firstName: string;
	lastName: string;
	phone: string | null;
	lastBody: string;
	lastDirection: 'outbound' | 'inbound';
	lastAt: string;
	unread: number;
};

export type PhoneNumber = {
	id: string;
	locationId: string;
	e164: string;
	status: 'active' | 'released';
	createdAt: string;
};

export type VoiceSettings = {
	locationId: string;
	timezone: string;
	forwardingNumber: string | null;
	missedCallTextbackEnabled: boolean;
	missedCallTemplate: string;
	businessHours: BusinessHours;
};

export type Call = {
	id: string;
	locationId: string;
	contactId: string;
	contactName: string;
	phone: string | null;
	direction: 'inbound' | 'outbound';
	status: CallStatus;
	from: string;
	to: string;
	startedAt: string;
	answeredAt: string | null;
	endedAt: string | null;
	durationSeconds: number | null;
	hangupCause: string | null;
	afterHours: boolean;
	textbackMessageId: string | null;
};

export type LocationUsage = {
	locationId: string;
	locationName: string;
	outboundMessages: number;
	inboundMessages: number;
	callSeconds: number;
};

export type BillingSummary = {
	status: BillingStatus;
	cardOnFile: boolean;
	trialEndsAt: string | null;
	currentPeriodStart: string;
	currentPeriodEnd: string;
	graceEndsAt: string | null;
	sendingDisabledAt: string | null;
	trialMessageCap: number;
	trialMessagesUsed: number;
	providerMode: 'stripe' | 'demo';
	usage: LocationUsage[];
};

export type MessagingRegistration = {
	id: string;
	legalName: string;
	ein: string | null;
	website: string | null;
	address: string;
	contactEmail: string;
	useCase: string;
	sampleMessage: string;
	status: 'submitted' | 'approved' | 'rejected';
	rejectionReason: string | null;
};

export type Company = {
	id: string;
	locationId: string;
	name: string;
	domain: string | null;
	createdAt: string;
	updatedAt: string;
};

export type PipelineStage = {
	id: string;
	pipelineId: string;
	name: string;
	position: number;
};

export type Pipeline = {
	id: string;
	name: string;
	isDefault: boolean;
	stages: PipelineStage[];
};

export type Opportunity = {
	id: string;
	locationId: string;
	pipelineId: string;
	stageId: string;
	stageName: string;
	contactId: string | null;
	companyId: string | null;
	contactName: string | null;
	companyName: string | null;
	name: string;
	amountCents: number | null;
	createdAt: string;
	updatedAt: string;
};

export type Activity = {
	id: string;
	type: string;
	summary: string;
	contactId: string | null;
	companyId: string | null;
	opportunityId: string | null;
	payload: Record<string, unknown>;
	createdAt: string;
};
