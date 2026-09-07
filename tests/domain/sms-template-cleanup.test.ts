import { expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import { cleanStoredSmsTemplates } from '$lib/server/domain/sms-template-cleanup';
import { createWorkspace, authContext } from '../helpers';
it('cleans saved templates prospectively, is idempotent and tenant scoped, and preserves substantive unsupported text',async()=>{
 const sql=getSql(); const a=authContext(await createWorkspace('gsm-clean')); const b=authContext(await createWorkspace('gsm-other'));
 for (const ctx of [a,b]) await sql`update locations set missed_call_template=${'We’re here — reply STOP. 😀'} where account_id=${ctx.accountId}`;
 expect(await cleanStoredSmsTemplates(sql,a.accountId)).toMatchObject({changed:1,applied:0});
 expect(await cleanStoredSmsTemplates(sql,a.accountId,true)).toMatchObject({applied:1});
 expect(await cleanStoredSmsTemplates(sql,a.accountId,true)).toMatchObject({changed:0});
 const [other]=await sql`select missed_call_template from locations where account_id=${b.accountId}`;
 expect(other.missed_call_template).toContain('—');
 await sql`update locations set missed_call_template=${'您好 STOP'} where account_id=${a.accountId}`;
 expect(await cleanStoredSmsTemplates(sql,a.accountId,true)).toMatchObject({blocked:1,applied:0});
});
it('cleans an unused AI draft without rewriting a used artifact',async()=>{
 const sql=getSql(); const ctx=authContext(await createWorkspace('draft-clean'));
 const {createContact}=await import('$lib/server/domain/contacts');
 const {uuidv7}=await import('$lib/server/ids');
 const contact=await createContact(sql,ctx,{firstName:'Draft',lastName:'Test',phone:'+15125550101',email:null});
 for(const status of ['ready','used']) await sql`insert into ai_artifacts(id,account_id,location_id,contact_id,kind,status,content,provider,model)
 values(${uuidv7()},${ctx.accountId},${ctx.locationId},${contact.id},'follow_up',${status},${sql.json({body:'We’re ready — call us.'})},'fake','test')`;
 expect(await cleanStoredSmsTemplates(sql,ctx.accountId,true)).toMatchObject({applied:1});
 const rows=await sql`select status,content from ai_artifacts where account_id=${ctx.accountId}`;
 expect(rows.find(r=>r.status==='ready')?.content.body).toBe("We're ready - call us.");
 expect(rows.find(r=>r.status==='used')?.content.body).toBe('We’re ready — call us.');
});
