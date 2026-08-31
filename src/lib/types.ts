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
	contactId: string;
	direction: 'outbound' | 'inbound';
	body: string;
	status: 'queued' | 'sent' | 'delivered' | 'failed' | 'received';
	notBefore: string | null;
	createdAt: string;
};

export type Conversation = {
	contactId: string;
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
