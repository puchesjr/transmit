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

export type Contact = {
	id: string;
	locationId: string;
	firstName: string;
	lastName: string;
	email: string | null;
	phone: string | null;
	createdAt: string;
	updatedAt: string;
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
