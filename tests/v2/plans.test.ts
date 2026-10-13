import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import express from 'express';
import sharp from 'sharp';
import {openV2Database} from '../../server/v2/db.js';
import {createConsentService,type ConsentCatalog} from '../../server/v2/consents.js';
import {createProjectService} from '../../server/v2/projects.js';
import {assetInsertMetadata} from '../../server/v2/assets.js';
import {normalizeInput} from '../../server/v2/images.js';
import {createPlanService,isPlanExpired,providerEditRequest,type PlanConfiguration} from '../../server/v2/plans.js';
import {createPlansRouter} from '../../server/v2/routes-plans.js';
import {resolveEdits,semanticDigest} from '../../shared/v2/edit-plan.js';
import {buildEditPrompt} from '../../shared/v2/provider-prompt.js';
import {profileCapabilities} from '../../server/v2/provider-profile.js';

const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const now='2026-10-13T03:00:00.000Z';
const catalog:ConsentCatalog={providers:['provider-test'],policies:[{id:'policy-test',version:'consent-v7',providerId:'provider-test',purposes:{photoRights:'photo-rights',uploadStorage:'private-storage',sharing:'model-precheck'}}]};
const image=(color:string)=>sharp({create:{width:64,height:40,channels:4,background:color}}).png().toBuffer();

function profile(id='profile-test',originalReference=true){return {id,version:'profile-v1',protocol:'openai-images-edits' as const,endpoint:'https://api.openai.com/v1/images/edits',model:'synthetic-model',templateVersion:'template-v1',fields:['bodyColor','wheelColor'] as const,originalReference,approvedForLive:true,officialEvidence:'https://developers.openai.com/synthetic-evidence',qualityEvidence:'synthetic-quality-review',maxCostMicrosUSD:25000,timeoutMs:1000,maxInputBytes:1_000_000,maxOutputBytes:2_000_000,maxResponseBytes:3_000_000,output:{format:'png' as const,size:'1024x1024' as const,quality:'low' as const}};}
function config(profiles=[{profile:profile(),providerId:'provider-test'}]):PlanConfiguration{return {liveEnabled:true,liveCandidates:profiles.map(x=>x.profile.id),profiles,policyVersion:'processing-v1',requiredGenerationPurpose:'model-precheck',budget:{maxSupplierCostMicrosUSD:30000},sourcePolicy:{version:'source-v1',allowedKinds:['user_upload']}};}
type Fixture={db:DatabaseSync;ownerId:string;projectId:string;originalId:string;consentId:string;version1:string;version3:string;version1Master:string;version3Master:string;close:()=>void};

async function fixture():Promise<Fixture>{
 const db=openV2Database(':memory:');const ownerId='owner-a',createdAt=now;db.prepare('INSERT INTO users(id,created_at) VALUES (?,?)').run(ownerId,createdAt);
 const consent=createConsentService(db,catalog).issue(ownerId,{policyId:'policy-test',acknowledgePhotoRights:true,acknowledgeUploadStorage:true,acknowledgeSharing:true}).consentRecordId;
 const source=await image('#144c88');const project=await createProjectService({db,consentCatalog:catalog,storageQuotaBytes:20_000_000}).create(ownerId,consent,source,'Synthetic project name','user_upload');
 async function addMaster(versionId:string,color:string,created:string){
   const normalized=await normalizeInput(await image(color));const assetId=randomUUID(),meta=assetInsertMetadata({id:assetId,ownerId,projectId:project.projectId,kind:'master',storageKey:randomUUID().replaceAll('-',''),createdAt:created},normalized);
   db.prepare(`INSERT INTO assets(id,owner_id,project_id,kind,mime,bytes,width,height,digest,storage_key,created_at,private_bytes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(meta.id,ownerId,project.projectId,'master',meta.mime,meta.bytes,meta.width,meta.height,meta.digest,meta.storage_key,created,normalized.bytes);
   db.prepare(`INSERT INTO versions(id,owner_id,project_id,parent_version_id,master_asset_id,display_asset_id,task_id,name,favorite,created_at)
     VALUES (?,?,?,NULL,?,NULL,NULL,?,0,?)`).run(versionId,ownerId,project.projectId,assetId,versionId,created);
   return assetId;
 }
 const version1='version-v1',version3='version-v3';const version1Master=await addMaster(version1,'#2458a0','2026-10-12T00:00:00.000Z');const version3Master=await addMaster(version3,'#a63325','2026-10-13T00:00:00.000Z');
 db.prepare('UPDATE projects SET cover_version_id=? WHERE id=?').run(version3,project.projectId);
 return {db,ownerId,projectId:project.projectId,originalId:project.originalAssetId,consentId:consent,version1,version3,version1Master,version3Master,close:()=>db.close()};
}
const request=(source:unknown,edits:Record<string,unknown>={bodyColor:{action:'set',value:'blue'}})=>({schemaVersion:2,source,operation:'detail',edits});
function service(f:Fixture,overrides:Partial<Parameters<typeof createPlanService>[0]>={}){return createPlanService({db:f.db,consentCatalog:catalog,config:config(),clock:()=>new Date(now),...overrides});}
function code(expected:string){return (error:unknown)=>error instanceof Error&&(error as {code?:string}).code===expected;}

test('plan quotes are closed by default and require server-approved source, profile, budget, and sharing consent',async()=>{
 const f=await fixture();try{const closed=createPlanService({db:f.db,consentCatalog:catalog,clock:()=>new Date(now)});
   await assert.rejects(()=>closed.quote(f.ownerId,f.projectId,f.consentId,request({kind:'original'})),code('PLAN_UNAVAILABLE'));
   assert.equal((f.db.prepare('SELECT count(*) n FROM plans').get() as {n:number}).n,0);
   const noSharing=createConsentService(f.db,catalog).issue(f.ownerId,{policyId:'policy-test',acknowledgePhotoRights:true,acknowledgeUploadStorage:true,acknowledgeSharing:false}).consentRecordId;
   await assert.rejects(()=>service(f).quote(f.ownerId,f.projectId,noSharing,request({kind:'original'})),code('CONSENT_INVALID'));
   assert.equal((f.db.prepare('SELECT count(*) n FROM plans').get() as {n:number}).n,0);
 }finally{f.close();}
});

test('original works without a prior result and a V1 selection resolves its exact master, never latest V3',async()=>{
 const f=await fixture();try{const create=service(f),original=await create.quote(f.ownerId,f.projectId,f.consentId,request({kind:'original'}));
   const v1=await create.quote(f.ownerId,f.projectId,f.consentId,request({kind:'version',versionId:f.version1}));
   assert.equal(original.semantic.source.assetId,f.originalId);assert.equal(original.semantic.source.versionId,undefined);
   assert.equal(v1.semantic.source.assetId,f.version1Master);assert.equal(v1.semantic.source.versionId,f.version1);
   assert.notEqual(v1.semantic.source.assetId,f.version3Master);assert.equal(v1.semantic.source.persistedSha256,sha((f.db.prepare('SELECT private_bytes FROM assets WHERE id=?').get(f.version1Master) as {private_bytes:Uint8Array}).private_bytes));
   assert.equal(original.semantic.outputCount,1);assert.equal(original.semantic.userCostUnits,1);
   assert.equal(Date.parse(original.expiresAt)-Date.parse(original.createdAt),10*60*1000);
 }finally{f.close();}
});

test('all legacy style ids expand to versioned server color recipes, keep means preserve, and explore edits are rejected',async()=>{
 const f=await fixture();try{const create=service(f);const expected=['clean','sport','dark','heritage','track','rally','touring','color'];
   for(const styleId of expected){const result=await create.quote(f.ownerId,f.projectId,f.consentId,{schemaVersion:2,source:{kind:'original'},operation:'explore',styleId,edits:{}});
     assert.equal(result.semantic.presetVersion,'form-presets-v1');assert.ok(result.semantic.desiredRecipe);
     if(styleId==='clean')assert.equal(result.semantic.desiredRecipe.preserve.includes('bodyColor'),true);
     assert.equal(Object.hasOwn(result.semantic.desiredRecipe,'prompt'),false);
   }
   await assert.rejects(()=>create.quote(f.ownerId,f.projectId,f.consentId,{schemaVersion:2,source:{kind:'original'},operation:'explore',styleId:'sport',edits:{bodyColor:{action:'set',value:'red'}}}),code('EXPLORE_OVERRIDES_UNSUPPORTED'));
   assert.equal((f.db.prepare('SELECT count(*) n FROM plans').get() as {n:number}).n,8);
 }finally{f.close();}
});

test('licensed demos are submit-ready from the demo wallet using upload consent and an isolated color-only registry',async()=>{
 const f=await fixture();try{
   const demoBytes=await image('#39744b'),registry=[{id:'demo-approved',bytes:demoBytes,licenseEvidence:'synthetic-license-record'}];
   const uploadOnly=createConsentService(f.db,catalog).issue(f.ownerId,{policyId:'policy-test',acknowledgePhotoRights:true,acknowledgeUploadStorage:true,acknowledgeSharing:false}).consentRecordId;
   const demo=await createProjectService({db:f.db,consentCatalog:catalog,storageQuotaBytes:20_000_000,demoRegistry:registry}).create(f.ownerId,uploadOnly,demoBytes,'Synthetic demo','licensed_demo','demo-approved');
   const demoConfig:PlanConfiguration={demoEnabled:true,demoPolicy:{version:'demo-v1',registry,fields:['bodyColor','wheelColor']}};
   const accepted=await createPlanService({db:f.db,consentCatalog:catalog,config:demoConfig,clock:()=>new Date(now)}).quote(f.ownerId,demo.projectId,uploadOnly,request({kind:'original'}));
   assert.equal(accepted.semantic.projectSource.kind,'licensed_demo');assert.equal(accepted.semantic.projectSource.licenseRegistryId,'demo-approved');
   assert.equal(accepted.semantic.walletScope,'demo');assert.equal(accepted.semantic.executionMode,'licensed_demo');assert.equal(accepted.semantic.userCostUnits,1);assert.equal(accepted.semantic.supplierExposureMicrosUSD,0);assert.equal(accepted.semantic.supplier,null);assert.equal(accepted.semantic.consent.purposes.length,2);
   const details=JSON.parse((f.db.prepare("SELECT details_json FROM audit_events WHERE owner_id=? AND event_type='project.source.created' AND details_json LIKE ?").get(f.ownerId,`%${demo.projectId}%`) as {details_json:string}).details_json) as Record<string,unknown>;
   f.db.prepare("UPDATE audit_events SET details_json=? WHERE event_type='project.source.created' AND details_json LIKE ?").run(JSON.stringify({...details,storedOriginalSha256:'f'.repeat(64)}),`%${demo.projectId}%`);
   await assert.rejects(()=>createPlanService({db:f.db,consentCatalog:catalog,config:demoConfig,clock:()=>new Date(now)}).quote(f.ownerId,demo.projectId,uploadOnly,request({kind:'original'})),code('SOURCE_PROVENANCE_INVALID'));
   f.db.prepare("DELETE FROM audit_events WHERE event_type='project.source.created' AND details_json LIKE ?").run(`%${f.projectId}%`);
   await assert.rejects(()=>createPlanService({db:f.db,consentCatalog:catalog,config:demoConfig,clock:()=>new Date(now)}).quote(f.ownerId,f.projectId,uploadOnly,request({kind:'original'})),code('SOURCE_NOT_ALLOWED'));
 }finally{f.close();}
});

test('generation requires the server-published sharing purpose, and freezes that purpose with provider limits',async()=>{
 const f=await fixture();try{
   const wrong=config();wrong.requiredGenerationPurpose='model-generation';
   await assert.rejects(()=>createPlanService({db:f.db,consentCatalog:catalog,config:wrong}).quote(f.ownerId,f.projectId,f.consentId,request({kind:'original'})),code('CONSENT_INVALID'));
   const missing=config();delete missing.requiredGenerationPurpose;
   await assert.rejects(()=>createPlanService({db:f.db,consentCatalog:catalog,config:missing}).quote(f.ownerId,f.projectId,f.consentId,request({kind:'original'})),code('PLAN_UNAVAILABLE'));
   const quoted=await service(f).quote(f.ownerId,f.projectId,f.consentId,request({kind:'original'}));
   assert.equal(quoted.semantic.generationPurpose,'model-precheck');assert.equal(quoted.semantic.walletScope,'live');assert.equal(quoted.semantic.executionMode,'live');
   assert.equal(quoted.semantic.supplier?.maxInputBytes,1_000_000);assert.equal(quoted.semantic.supplier?.maxOutputBytes,2_000_000);assert.equal(quoted.semantic.supplier?.maxResponseBytes,3_000_000);assert.equal(quoted.semantic.supplier?.timeoutMs,1000);
 }finally{f.close();}
});

test('desired recipe inherits version recipe intent without treating unverified targets as observations',async()=>{
 const f=await fixture();try{
   const oldRecipe={source:'legacy',verification:'unverified',styleId:'sport',target:{bodyColor:'blue',wheelColor:'bronze'}};
   f.db.prepare('UPDATE versions SET recipe_json=? WHERE id=?').run(JSON.stringify(oldRecipe),f.version1);
   const quoted=await service(f).quote(f.ownerId,f.projectId,f.consentId,request({kind:'version',versionId:f.version1},{wheelColor:{action:'set',value:'silver'}}));
   assert.deepEqual(quoted.semantic.desiredRecipe.changes,[{field:'bodyColor',action:'set',value:'blue'},{field:'wheelColor',action:'set',value:'silver'}]);
   assert.equal(quoted.semantic.desiredRecipe.inherited.styleId,'sport');assert.equal(quoted.semantic.desiredRecipe.inherited.verification,'unverified');
   const explicitSame=await service(f).quote(f.ownerId,f.projectId,f.consentId,request({kind:'version',versionId:f.version1},{bodyColor:{action:'set',value:'blue'},wheelColor:{action:'set',value:'silver'}}));
   assert.equal(explicitSame.semantic.desiredRecipe.changes.some(x=>x.field==='bodyColor'&&x.value==='blue'),true);
 }finally{f.close();}
});

test('provider edit adapter expands only the frozen current preset and never reapplies inherited recipe intent',async()=>{
 const f=await fixture();try{
   const create=service(f),capabilities=profileCapabilities(profile());
   const explore=await create.quote(f.ownerId,f.projectId,f.consentId,{schemaVersion:2,source:{kind:'original'},operation:'explore',styleId:'sport',edits:{}});
   const exploreRequest=providerEditRequest(explore);
   const exploreResolved=resolveEdits(exploreRequest,capabilities,{});
   assert.deepEqual(exploreResolved.changes,[{field:'bodyColor',action:'set',value:'blue'},{field:'wheelColor',action:'set',value:'bronze'}]);
   const explorePrompt=buildEditPrompt(exploreRequest,capabilities,{});
   assert.match(explorePrompt,/body paint color to deep blue/);assert.match(explorePrompt,/wheel finish color to warm bronze/);
   assert.doesNotMatch(explorePrompt,/widebody|subtle front lip|lower stance/i);

   const oldRecipe={source:'legacy',verification:'unverified',styleId:'sport',target:{bodyColor:'blue',wheelColor:'bronze'}};
   f.db.prepare('UPDATE versions SET recipe_json=? WHERE id=?').run(JSON.stringify(oldRecipe),f.version1);
   const detail=await create.quote(f.ownerId,f.projectId,f.consentId,request({kind:'version',versionId:f.version1},{wheelColor:{action:'set',value:'silver'}}));
   assert.ok(detail.semantic.desiredRecipe.changes.some(x=>x.field==='bodyColor'&&x.value==='blue'));
   const detailRequest=providerEditRequest(detail),detailResolved=resolveEdits(detailRequest,capabilities,{});
   assert.deepEqual(detailResolved.changes,[{field:'wheelColor',action:'set',value:'silver'}]);
   const detailPrompt=buildEditPrompt(detailRequest,capabilities,{});
   assert.match(detailPrompt,/wheel finish color to silver/);assert.doesNotMatch(detailPrompt,/Change only the body paint color to deep blue/);

   const mismatched=structuredClone(explore);mismatched.semantic.presetVersion='form-presets-v2';
   assert.throws(()=>providerEditRequest(mismatched),code('PLAN_ROW_INVALID'));
   const badDigest=structuredClone(explore);badDigest.planDigest='f'.repeat(64);
   assert.throws(()=>providerEditRequest(badDigest),code('PLAN_ROW_INVALID'));
 }finally{f.close();}
});

test('restore_original requires the frozen capability and fails before inserting a plan',async()=>{
 const f=await fixture();try{const create=service(f,{config:config([{profile:profile('profile-no-original',false),providerId:'provider-test'}])});
   await assert.rejects(()=>create.quote(f.ownerId,f.projectId,f.consentId,request({kind:'version',versionId:f.version1},{bodyColor:{action:'restore_original'}})),code('ORIGINAL_REFERENCE_UNSUPPORTED'));
   assert.equal((f.db.prepare('SELECT count(*) n FROM plans').get() as {n:number}).n,0);
 }finally{f.close();}
});

test('snapshot digest changes for semantic edits but excludes project display name and current wallet state',async()=>{
 const f=await fixture();try{const create=service(f),base=await create.quote(f.ownerId,f.projectId,f.consentId,request({kind:'original'},{bodyColor:{action:'set',value:'blue'}}));
   f.db.prepare('UPDATE projects SET name=? WHERE id=?').run('A renamed display-only project',f.projectId);
   f.db.prepare("INSERT INTO credit_lots(id,owner_id,kind,units,available_units,created_at) VALUES ('lot-test',?,'promo',50,50,?)").run(f.ownerId,now);
   const same=await create.quote(f.ownerId,f.projectId,f.consentId,request({kind:'original'},{bodyColor:{action:'set',value:'blue'}}));
   const changed=await create.quote(f.ownerId,f.projectId,f.consentId,request({kind:'original'},{bodyColor:{action:'set',value:'green'}}));
   assert.equal(base.planDigest,same.planDigest);assert.notEqual(base.planDigest,changed.planDigest);
   const stored=f.db.prepare('SELECT snapshot_json FROM plans WHERE id=?').get(base.planId) as {snapshot_json:string};assert.doesNotMatch(stored.snapshot_json,/A renamed display-only project/);
   assert.equal(base.semantic.userCostUnits,1);assert.equal(base.semantic.outputCount,1);
 }finally{f.close();}
});

test('requested history is not verified observation and client-supplied verification claims are rejected',async()=>{
 const f=await fixture();try{const create=service(f);const requested=await create.quote(f.ownerId,f.projectId,f.consentId,request({kind:'original'},{bodyColor:{action:'set',value:'blue'}}));
   const repeated=await create.quote(f.ownerId,f.projectId,f.consentId,request({kind:'original'},{bodyColor:{action:'set',value:'blue'}}));
   assert.equal(requested.semantic.desiredRecipe.changes.some(x=>x.field==='bodyColor'),true);
   assert.equal(repeated.semantic.desiredRecipe.changes.some(x=>x.field==='bodyColor'),true);
   await assert.rejects(()=>create.quote(f.ownerId,f.projectId,f.consentId,{...request({kind:'original'}),observations:{bodyColor:{value:'blue',provenance:'verified'}}}),code('UNKNOWN_FIELD'));
 }finally{f.close();}
});

test('a consent revoked while F06 reads the selected source cannot leave a quote',async()=>{
 const f=await fixture();try{const create=service(f);const pending=create.quote(f.ownerId,f.projectId,f.consentId,request({kind:'version',versionId:f.version1}));
   f.db.prepare('UPDATE consents SET revoked_at=? WHERE id=?').run(now,f.consentId);
   await assert.rejects(pending,code('CONSENT_INVALID'));assert.equal((f.db.prepare('SELECT count(*) n FROM plans').get() as {n:number}).n,0);
 }finally{f.close();}
});

test('source reassignment, project tombstone, recipe changes, and configuration changes during async reads are rechecked before insert',async()=>{
 for(const race of ['version','project','recipe','config'] as const){const f=await fixture();try{let reads=0;const first=config(),second=config([{profile:profile('profile-new'),providerId:'provider-test'}]);
   const create=service(f,{getConfig:()=>race==='config'&&++reads>1?second:first});
   const pending=create.quote(f.ownerId,f.projectId,f.consentId,request({kind:'version',versionId:f.version1}));
   if(race==='version')f.db.prepare('UPDATE versions SET master_asset_id=? WHERE id=?').run(f.version3Master,f.version1);
   if(race==='recipe')f.db.prepare('UPDATE versions SET recipe_json=? WHERE id=?').run(JSON.stringify({source:'legacy',verification:'unverified',target:{bodyColor:'green'}}),f.version1);
   if(race==='project')f.db.prepare('UPDATE projects SET deleted_at=? WHERE id=?').run(now,f.projectId);
   await assert.rejects(pending,code(race==='config'?'PLAN_CONFIGURATION_CHANGED':race==='project'?'SOURCE_NOT_FOUND':'SOURCE_CHANGED'));
   assert.equal((f.db.prepare('SELECT count(*) n FROM plans').get() as {n:number}).n,0);
  }finally{f.close();}}
});

test('plan row validator checks owner, project, exact source, cost, expiry, and canonical digest for F09',async()=>{
 const f=await fixture();try{const create=service(f),quoted=await create.quote(f.ownerId,f.projectId,f.consentId,request({kind:'version',versionId:f.version1}));
   const row=f.db.prepare('SELECT * FROM plans WHERE id=?').get(quoted.planId) as Record<string,unknown>;
   const loaded=await import('../../server/v2/plans.js').then(m=>m.validateStoredPlanRow(row));assert.equal(loaded.planDigest,quoted.planDigest);assert.equal(loaded.semantic.source.assetId,f.version1Master);
   assert.equal(isPlanExpired(quoted,new Date(quoted.expiresAt)),true);assert.equal(isPlanExpired(quoted,new Date(now)),false);
   await assert.rejects(()=>import('../../server/v2/plans.js').then(m=>m.validateStoredPlanRow({...row,owner_id:'owner-b'})),code('PLAN_ROW_INVALID'));
   await assert.rejects(()=>import('../../server/v2/plans.js').then(m=>m.validateStoredPlanRow({...row,user_cost_units:2})),code('PLAN_ROW_INVALID'));
   const forged=JSON.parse(String(row.snapshot_json)) as {semantic:Record<string,any>;planDigest:string};forged.semantic.requestEdits.edits.bodyColor.value='green';forged.planDigest=await semanticDigest(forged.semantic);
   await assert.rejects(()=>import('../../server/v2/plans.js').then(m=>m.validateStoredPlanRow({...row,snapshot_json:JSON.stringify(forged),plan_digest:forged.planDigest})),code('PLAN_ROW_INVALID'));
   const extra=JSON.parse(String(row.snapshot_json)) as {semantic:Record<string,any>;planDigest:string};extra.semantic.supplier.unreviewedEndpoint='https://attacker.invalid/';extra.planDigest=await semanticDigest(extra.semantic);
   await assert.rejects(()=>import('../../server/v2/plans.js').then(m=>m.validateStoredPlanRow({...row,snapshot_json:JSON.stringify(extra),plan_digest:extra.planDigest})),code('PLAN_ROW_INVALID'));
   const consent=JSON.parse(String(row.snapshot_json)) as {semantic:Record<string,any>;planDigest:string};consent.semantic.consent.purposes=['photo-rights','private-storage'];consent.planDigest=await semanticDigest(consent.semantic);
   await assert.rejects(()=>import('../../server/v2/plans.js').then(m=>m.validateStoredPlanRow({...row,snapshot_json:JSON.stringify(consent),plan_digest:consent.planDigest})),code('PLAN_ROW_INVALID'));
 }finally{f.close();}
});

test('F09 service helpers re-read the exact frozen image and synchronously reject revocation or configuration drift',async()=>{
 const f=await fixture();try{const create=service(f),quoted=await create.quote(f.ownerId,f.projectId,f.consentId,request({kind:'version',versionId:f.version1}));
   const inputs=await create.readCurrentInputs(quoted);assert.equal(inputs.source.row.id,f.version1Master);assert.equal(inputs.source.provenance.canonicalSha256,quoted.semantic.source.canonicalSha256);create.assertCurrent(quoted);
   f.db.prepare('UPDATE consents SET revoked_at=? WHERE id=?').run(now,f.consentId);assert.throws(()=>create.assertCurrent(quoted),code('CONSENT_INVALID'));
 }finally{f.close();}
});

test('quotes store observations separately as unknown and reject invented verified image facts',async()=>{
 const f=await fixture();try{const quoted=await service(f).quote(f.ownerId,f.projectId,f.consentId,request({kind:'original'}));
   assert.deepEqual(quoted.semantic.observedRecipe,{status:'unknown',fields:{}});
   const row=f.db.prepare('SELECT * FROM plans WHERE id=?').get(quoted.planId) as Record<string,unknown>;
   const forged=JSON.parse(String(row.snapshot_json));forged.semantic.observedRecipe={status:'verified',fields:{bodyColor:'blue'}};forged.planDigest=await semanticDigest(forged.semantic);
   await assert.rejects(()=>import('../../server/v2/plans.js').then(m=>m.validateStoredPlanRow({...row,snapshot_json:JSON.stringify(forged),plan_digest:forged.planDigest})),code('PLAN_ROW_INVALID'));
 }finally{f.close();}
});

test('current-input helpers bind the stored quote before and after awaits without expiring accepted jobs',async()=>{
 const f=await fixture();try{const create=service(f),quoted=await create.quote(f.ownerId,f.projectId,f.consentId,request({kind:'original'}));
   assert.throws(()=>create.assertCurrent({...quoted,planId:'unpersisted-plan'}),code('PLAN_ROW_INVALID'));
   assert.throws(()=>create.assertCurrent({...quoted,planDigest:'f'.repeat(64)}),code('PLAN_ROW_INVALID'));
   assert.equal(isPlanExpired(quoted,new Date(Date.parse(quoted.expiresAt)+1)),true);create.assertCurrent(quoted);
   const pending=create.readCurrentInputs(quoted);f.db.prepare('UPDATE plans SET snapshot_json=? WHERE id=?').run('{}',quoted.planId);
   await assert.rejects(pending,code('PLAN_ROW_INVALID'));
 }finally{f.close();}
});

test('the plans route uses an authenticated actor and returns only the S01 error envelope',async()=>{
 const f=await fixture();const app=express();app.use('/api/v2',createPlansRouter({db:f.db,actorResolver:async req=>req.get('authorization')==='Bearer owner' ? f.ownerId : null,consentCatalog:catalog,config:config(),clock:()=>new Date(now)}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const api=`http://127.0.0.1:${address.port}/api/v2`;
 try{const denied=await fetch(`${api}/projects/${f.projectId}/plans`,{method:'POST',headers:{'content-type':'application/json','X-Owner-Id':f.ownerId,'X-Form-Consent-Id':f.consentId},body:JSON.stringify(request({kind:'original'}))});assert.equal(denied.status,401);
   const error=await denied.json() as Record<string,unknown>;assert.deepEqual(Object.keys(error).sort(),['code','message','requestId','retryable']);assert.equal(error.code,'AUTH_REQUIRED');assert.notEqual(error.requestId,undefined);
   const accepted=await fetch(`${api}/projects/${f.projectId}/plans`,{method:'POST',headers:{authorization:'Bearer owner','content-type':'application/json','X-Form-Consent-Id':f.consentId},body:JSON.stringify(request({kind:'original'}))});assert.equal(accepted.status,201);assert.equal(accepted.headers.get('cache-control'),'private, no-store');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));f.close();}
});
