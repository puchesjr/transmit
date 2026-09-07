import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelnyxMessagingProvider } from '$lib/server/providers/telnyx';

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('Telnyx messaging provider', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('searches US local SMS numbers only', async () => {
		vi.stubEnv('TELNYX_API_KEY', 'KEY');
		const fetchMock = vi.fn(async (url: string) => {
			expect(String(url)).toContain('filter%5Bphone_number_type%5D=local');
			expect(String(url)).not.toContain('toll_free');
			return jsonResponse(200, { data: [{ phone_number: '+15125550100' }] });
		});
		vi.stubGlobal('fetch', fetchMock);
		await expect(new TelnyxMessagingProvider().searchNumbers('512')).resolves.toEqual([
			{ e164: '+15125550100' }
		]);
	});

	it('submits a LOW_VOLUME brand and campaign and reads wrapped ids', async () => {
		vi.stubEnv('TELNYX_API_KEY', 'KEY');
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			const path = String(url).replace('https://api.telnyx.com/v2', '');
			if (path === '/10dlc/brand') {
				expect(JSON.parse(String(init?.body))).toMatchObject({
					entityType: 'PRIVATE_PROFIT',
					city: 'Austin',
					state: 'TX',
					postalCode: '78701',
					phone: '+15125550100',
					isReseller: false
				});
				return jsonResponse(200, { data: { brandId: 'brand_1' } });
			}
			if (path === '/10dlc/campaignBuilder') {
				expect(JSON.parse(String(init?.body))).toMatchObject({
					brandId: 'brand_1',
					usecase: 'LOW_VOLUME',
					subscriberOptout: true
				});
				return jsonResponse(200, { data: { campaignId: 'camp_1' } });
			}
			throw new Error(`unexpected ${path}`);
		});
		vi.stubGlobal('fetch', fetchMock);
		await expect(
			new TelnyxMessagingProvider().submitRegistration({
				legalName: 'Acme Diesel LLC',
				ein: '12-3456789',
				website: 'https://acme.test',
				address: '1 Main St',
				city: 'Austin',
				region: 'TX',
				postalCode: '78701',
				contactEmail: 'owner@acme.test',
				contactPhone: '+15125550100',
				useCase: 'Missed-call textback and appointment follow-up for our shop.',
				sampleMessage: 'Hi, thanks for calling. Reply STOP to opt out.'
			})
		).resolves.toEqual({ brandId: 'brand_1', campaignId: 'camp_1', status: 'submitted' });
	});

	it('assigns a number to a campaign and treats already-assigned as success', async () => {
		vi.stubEnv('TELNYX_API_KEY', 'KEY');
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method === 'GET') return jsonResponse(200, { phoneNumber: '+15125550100', campaignId: 'camp_1', assignmentStatus: 'ASSIGNED' });
			expect(String(url)).toMatch(/\/10dlc\/phone_number_campaigns$/);
			expect(init?.method).toBe('POST');
			expect(JSON.parse(String(init?.body))).toEqual({
				phoneNumber: '+15125550100',
				campaignId: 'camp_1'
			});
			return jsonResponse(409, { errors: [{ detail: 'already assigned' }] });
		});
		vi.stubGlobal('fetch', fetchMock);
		await expect(
			new TelnyxMessagingProvider().assignNumberToCampaign({
				phoneNumber: '+15125550100',
				campaignId: 'camp_1'
			})
		).resolves.toBeUndefined();
	});

	it('maps an ACTIVE campaign to approved', async () => {
		vi.stubEnv('TELNYX_API_KEY', 'KEY');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse(200, { data: { campaignStatus: 'ACTIVE' } }))
		);
		await expect(
			new TelnyxMessagingProvider().getRegistrationStatus('brand_1', 'camp_1')
		).resolves.toBe('approved');
	});
});


it('does not accept a campaign conflict for another campaign or a pending assignment', async () => {
	vi.stubEnv('TELNYX_API_KEY', 'KEY');
	try {
		for (const assignment of [
			{ phoneNumber: '+15125550100', campaignId: 'another-campaign', assignmentStatus: 'ASSIGNED' },
			{ phoneNumber: '+15125550100', campaignId: 'camp_1', assignmentStatus: 'PENDING_ASSIGNMENT' }
		]) {
			vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'GET'
				? jsonResponse(200, assignment) : jsonResponse(409, { errors: [{ detail: 'already assigned' }] })));
			await expect(new TelnyxMessagingProvider().assignNumberToCampaign({ phoneNumber: '+15125550100', campaignId: 'camp_1' })).rejects.toThrow('could not be verified');
		}
	} finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

it('forces GSM-7 at the provider boundary', async()=>{
 vi.stubEnv('TELNYX_API_KEY','KEY');
 const fetchMock=vi.fn(async (_url:string,init?:RequestInit)=>{
  expect(JSON.parse(String(init?.body))).toMatchObject({encoding:'gsm7',type:'SMS',text:'Hello'});
  return jsonResponse(200,{data:{id:'sms-one'}});
 });
 vi.stubGlobal('fetch',fetchMock);
 try { expect(await new TelnyxMessagingProvider().sendMessage({from:'+15125550100',to:'+15125550200',body:'Hello'})).toEqual({providerMessageId:'sms-one'}); }
 finally {vi.unstubAllEnvs();vi.unstubAllGlobals();}
});
