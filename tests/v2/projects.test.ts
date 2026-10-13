import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import type {Server} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import express from 'express';
import sharp from 'sharp';
import {createProjectsRouter} from '../../server/v2/routes-projects.js';
import {createConsentService,EMPTY_CONSENT_CATALOG, type ConsentCatalog} from '../../server/v2/consents.js';
import {createProjectService,ProjectError} from '../../server/v2/projects.js';
import {IMAGE_LIMITS, normalizeInput, createDisplayAsset} from '../../server/v2/images.js';
import {migrateLegacyDatabase} from '../../server/v2/migrate.js';

const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const blob=(b:Buffer)=>new Blob([Uint8Array.from(b)]);
const sample=()=>sharp({create:{width:13,height:7,channels:4,background:{r:25,g:80,b:160,alpha:.7}}}).png().toBuffer();
const catalog:ConsentCatalog={providers:['provider-test'],policies:[{id:'policy-test',version:'v7',providerId:'provider-test',purposes:{photoRights:'photo-rights',uploadStorage:'private-storage',sharing:'model-precheck'}}]};
type Fixture={db:DatabaseSync;api:string;close:()=>Promise<void>};
async function serve(opts:{catalog?:ConsentCatalog|null;storageQuotaBytes?:number|null;demoRegistry?:unknown[];actor?:boolean;maxConcurrentUploads?:number}={}):Promise<Fixture>{
  const db=new DatabaseSync(':memory:');
  const {openV2Database}=await import('../../server/v2/db.js');db.close();const actual=openV2Database(':memory:');
  for(const id of ['owner-a','owner-b'])actual.prepare('INSERT INTO users(id,created_at) VALUES (?,?)').run(id,new Date().toISOString());
  const app=express();app.use('/api/v2',createProjectsRouter({db:actual,
    actorResolver:opts.actor===false?undefined as never:async req=>req.get('authorization')==='Bearer a'?'owner-a':req.get('authorization')==='Bearer b'?'owner-b':null,
    consentCatalog:opts.catalog===undefined?catalog:opts.catalog,
    storageQuotaBytes:opts.storageQuotaBytes===undefined?20_000_000:opts.storageQuotaBytes,
    demoRegistry:opts.demoRegistry as never,maxConcurrentUploads:opts.maxConcurrentUploads}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {db:actual,api:`http://127.0.0.1:${address.port}/api/v2`,close:()=>new Promise(resolve=>server.close(()=>{actual.close();resolve();}))};
}
async function issue(api:string,owner='a',acks={acknowledgePhotoRights:true,acknowledgeUploadStorage:true,acknowledgeSharing:true}){
  const r=await fetch(api+'/consents',{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify({policyId:'policy-test',...acks})});
  return {response:r,body:await r.json() as Record<string,unknown>};
}
async function upload(api:string,consentId:string,owner='a',form?:FormData){const data=form??new FormData();if(!form){data.set('name','Synthetic private project');data.set('file',blob(await sample()),'synthetic.png');}
  return fetch(api+'/projects',{method:'POST',headers:{authorization:`Bearer ${owner}`,'X-Owner-Id':'owner-b','X-Form-Consent-Id':consentId},body:data});}

test('consent catalog is closed by default and unauthenticated X-Owner-Id cannot create consent or projects',async()=>{
  const f=await serve({catalog:EMPTY_CONSENT_CATALOG});try{
    const noActor=await fetch(f.api+'/consents',{method:'POST',headers:{'X-Owner-Id':'owner-a','X-Request-Id':'client-ref','content-type':'application/json'},body:'{}'});assert.equal(noActor.status,401);
    const denied=await noActor.json() as Record<string,unknown>;assert.deepEqual(Object.keys(denied).sort(),['code','message','requestId','retryable']);assert.notEqual(denied.requestId,'client-ref');assert.equal(denied.retryable,false);
    const malformed=await fetch(f.api+'/consents',{method:'POST',headers:{authorization:'Bearer a','content-type':'application/json'},body:'{'});assert.equal(malformed.status,400);assert.deepEqual(Object.keys(await malformed.json() as object).sort(),['code','message','requestId','retryable']);
    const result=await issue(f.api);assert.equal(result.response.status,503);assert.equal(result.body.code,'CONSENT_UNAVAILABLE');
    assert.equal((f.db.prepare('SELECT count(*) n FROM consents').get() as {n:number}).n,0);
    const rejected=await upload(f.api,'not-a-consent');assert.equal(rejected.status,403);
    assert.equal((f.db.prepare('SELECT count(*) n FROM projects').get() as {n:number}).n,0);
  }finally{await f.close();}
  const closed=await serve({actor:false});try{assert.equal((await issue(closed.api)).response.status,401);assert.equal((closed.db.prepare('SELECT count(*) n FROM consents').get() as {n:number}).n,0);}finally{await closed.close();}
});

test('only server-published policy/provider/purposes and distinct acknowledgments issue an owner-bound consent',async()=>{
  const f=await serve();try{
    const missingRights=await issue(f.api,'a',{acknowledgePhotoRights:false,acknowledgeUploadStorage:true,acknowledgeSharing:true});assert.equal(missingRights.response.status,400);
    const accepted=await issue(f.api,'a');assert.equal(accepted.response.status,201);assert.equal(accepted.response.headers.get('cache-control'),'private, no-store');assert.equal(typeof accepted.body.consentRecordId,'string');
    const row=f.db.prepare('SELECT owner_id,policy_version,provider_id,purposes_json,revoked_at FROM consents WHERE id=?').get(String(accepted.body.consentRecordId)) as {owner_id:string;policy_version:string;provider_id:string;purposes_json:string;revoked_at:string|null};
    assert.equal(row.owner_id,'owner-a');assert.equal(row.policy_version,'v7');assert.equal(row.provider_id,'provider-test');assert.deepEqual(JSON.parse(row.purposes_json),['photo-rights','private-storage','model-precheck']);assert.equal(row.revoked_at,null);
    const sharing=createConsentService(f.db,catalog).assertSharing(String(accepted.body.consentRecordId),'owner-a');assert.equal(sharing.policyId,'policy-test');assert.equal(sharing.providerId,'provider-test');assert.deepEqual(sharing.purposes,['photo-rights','private-storage','model-precheck']);
    const noShare=await issue(f.api,'a',{acknowledgePhotoRights:true,acknowledgeUploadStorage:true,acknowledgeSharing:false});assert.equal(noShare.response.status,201);
    assert.throws(()=>createConsentService(f.db,catalog).assertSharing(String(noShare.body.consentRecordId),'owner-a'),/CONSENT_INVALID/);
    const purposes=f.db.prepare('SELECT purposes_json FROM consents WHERE id=?').get(String(noShare.body.consentRecordId)) as {purposes_json:string};assert.deepEqual(JSON.parse(purposes.purposes_json),['photo-rights','private-storage']);
    assert.equal((await upload(f.api,String(noShare.body.consentRecordId))).status,201);
    const forged=await fetch(f.api+'/consents',{method:'POST',headers:{authorization:'Bearer a','content-type':'application/json'},body:JSON.stringify({policyId:'policy-test',policyVersion:'admin',providerId:'evil',purposes:['admin'],acknowledgePhotoRights:true,acknowledgeUploadStorage:true,acknowledgeSharing:true})});assert.equal(forged.status,400);
  }finally{await f.close();}
});

test('upload creates normalized private original/display and a privacy-minimized source event atomically',async()=>{
  const f=await serve();try{const c=await issue(f.api),source=await sample(),form=new FormData();form.set('name','Synthetic private project');form.set('file',blob(source),'synthetic.png');const response=await upload(f.api,String(c.body.consentRecordId),'a',form);assert.equal(response.status,201);assert.equal(response.headers.get('cache-control'),'private, no-store');const body=await response.json() as {projectId:string;originalAssetId:string;displayAssetId:string;sourceKind:string};
    assert.equal(body.sourceKind,'user_upload');const assets=f.db.prepare('SELECT id,kind,mime,bytes,width,height,digest,storage_key,private_bytes FROM assets WHERE project_id=? ORDER BY kind').all(body.projectId) as Array<{id:string;kind:string;mime:string;bytes:number;width:number;height:number;digest:string;storage_key:string;private_bytes:Uint8Array}>;
    assert.deepEqual(assets.map(x=>x.kind),['display','original']);for(const a of assets){assert.equal(a.mime,'image/png');assert.equal(a.bytes,a.private_bytes.length);assert.match(a.storage_key,/^[a-f0-9]{48}$/);assert.equal(a.digest,sha(a.private_bytes));assert.ok(a.width&&a.height);}
    const project=f.db.prepare('SELECT owner_id,original_asset_id,name FROM projects WHERE id=?').get(body.projectId) as {owner_id:string;original_asset_id:string;name:string};assert.equal(project.owner_id,'owner-a');assert.equal(project.original_asset_id,body.originalAssetId);assert.equal(project.name,'Synthetic private project');
    const event=f.db.prepare("SELECT details_json FROM audit_events WHERE event_type='project.source.created' AND owner_id='owner-a'").get() as {details_json:string};const details=JSON.parse(event.details_json) as Record<string,unknown>;
    assert.equal(details.eventVersion,1);assert.equal(details.projectId,body.projectId);assert.equal(details.sourceKind,'user_upload');assert.equal(details.consentId,c.body.consentRecordId);assert.equal(details.sourceSha256,sha(source));assert.equal(details.storedOriginalSha256,assets.find(x=>x.kind==='original')?.digest);assert.equal(details.normalizerVersion,'form-srgb-rgba-v1');
    const eventText=JSON.stringify(details);assert.doesNotMatch(eventText,/Synthetic private project|synthetic\.png|photo|cookie|base64/i);assert.equal((f.db.prepare('SELECT count(*) n FROM projects').get() as {n:number}).n,1);
  }finally{await f.close();}
});

test('wrong-owner, revoked, stale-policy, and changed-provider consents fail before parsing or storage',async()=>{
  for(const mode of ['owner','revoked','policy','provider'] as const){const f=await serve();try{const c=await issue(f.api);const id=String(c.body.consentRecordId);if(mode==='revoked')f.db.prepare('UPDATE consents SET revoked_at=? WHERE id=?').run(new Date().toISOString(),id);
      const header=mode==='owner'?'b':'a';const catalog2=mode==='policy'?{...catalog,policies:[{...catalog.policies[0],version:'v8'}]}:mode==='provider'?{...catalog,policies:[{...catalog.policies[0],providerId:'provider-new'}],providers:['provider-new']}:catalog;
      if(mode!=='revoked'&&mode!=='owner'){
        const app=express();app.use('/api/v2',createProjectsRouter({db:f.db,actorResolver:async()=>'owner-a',consentCatalog:catalog2,storageQuotaBytes:20_000_000}));
        const s=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>s.once('listening',resolve));const a=s.address();assert.ok(a&&typeof a!=='string');
        try{const r=await fetch(`http://127.0.0.1:${a.port}/api/v2/projects`,{method:'POST',headers:{authorization:'Bearer a','X-Form-Consent-Id':id,'content-type':'text/plain'},body:'must not parse'});assert.equal(r.status,403);assert.equal((await r.json() as {code:string}).code,'CONSENT_INVALID');}finally{await new Promise<void>(resolve=>s.close(()=>resolve()));}
      }else{const r=await fetch(f.api+'/projects',{method:'POST',headers:{authorization:`Bearer ${header}`,'X-Form-Consent-Id':id,'content-type':'text/plain'},body:'must not parse'});assert.equal(r.status,403);assert.equal((await r.json() as {code:string}).code,'CONSENT_INVALID');}
      assert.equal((f.db.prepare('SELECT count(*) n FROM projects').get() as {n:number}).n,0);
    }finally{await f.close();}}
});

test('audit insertion failure rolls back the project and both private asset BLOBs',async()=>{
  const f=await serve();try{const c=await issue(f.api);f.db.exec("CREATE TRIGGER fail_source_event BEFORE INSERT ON audit_events WHEN NEW.event_type='project.source.created' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END");
    const r=await upload(f.api,String(c.body.consentRecordId));assert.equal(r.status,500);assert.equal((await r.json() as {code:string}).code,'PROJECT_CREATE_FAILED');
    for(const table of ['projects','assets','audit_events'])assert.equal((f.db.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n,0);
  }finally{await f.close();}
});

test('concurrent project requests recheck storage quota inside SQLite transaction',async()=>{
  const src=await sample(),normalized=await normalizeInput(src),display=await createDisplayAsset(normalized),quota=normalized.bytes.length+display.bytes.length;
  const f=await serve({storageQuotaBytes:quota,maxConcurrentUploads:2});try{const c=await issue(f.api);const results=await Promise.all([upload(f.api,String(c.body.consentRecordId)),upload(f.api,String(c.body.consentRecordId))]);
    assert.deepEqual(results.map(x=>x.status).sort(),[201,409]);assert.equal((f.db.prepare('SELECT count(*) n FROM projects').get() as {n:number}).n,1);
    const stored=(f.db.prepare('SELECT coalesce(sum(bytes),0) n FROM assets').get() as {n:number}).n;assert.equal(stored,quota);assert.ok(stored<=quota);
  }finally{await f.close();}
});

test('multipart limits, duplicated fields, fake demo uploads, and unlicensed demos are rejected',async()=>{
  const f=await serve();try{const c=await issue(f.api),id=String(c.body.consentRecordId);
    const repeated=new FormData();repeated.append('name','one');repeated.append('name','two');repeated.set('file',blob(await sample()),'x.png');assert.equal((await upload(f.api,id,'a',repeated)).status,400);
    const fakeDemo=new FormData();fakeDemo.set('demoId','demo-unlisted');fakeDemo.set('file',blob(await sample()),'user.png');assert.equal((await upload(f.api,id,'a',fakeDemo)).status,400);
    const noFile=new FormData();noFile.set('demoId','demo-unlisted');assert.equal((await upload(f.api,id,'a',noFile)).status,403);
    const huge=new FormData();huge.set('file',blob(Buffer.alloc(10*1024*1024+1)),'large.png');assert.equal((await upload(f.api,id,'a',huge)).status,413);
    const invalid=new FormData();invalid.set('file',blob(Buffer.from('not an image')),'wrong.png');const unreadable=await upload(f.api,id,'a',invalid);assert.equal(unreadable.status,422);const imageError=await unreadable.json() as {code:string;message:string;requestId:string};assert.equal(imageError.code,'INPUT_UNSUPPORTED_FORMAT');assert.match(imageError.message,/format/i);assert.doesNotMatch(JSON.stringify(imageError),/sharp|vips|path|wrong\.png/i);
    const badEncoding=await fetch(f.api+'/projects',{method:'POST',headers:{authorization:'Bearer a','X-Form-Consent-Id':id,'Content-Type':'multipart/form-data; boundary=abc','Content-Encoding':'gzip'},body:'ignored'});assert.equal(badEncoding.status,415);
    assert.equal((f.db.prepare('SELECT count(*) n FROM projects').get() as {n:number}).n,0);assert.equal(IMAGE_LIMITS.inputBytes,10*1024*1024);
  }finally{await f.close();}
});

test('licensed demos are server-selected, and missing storage quota fails closed before multipart parsing',async()=>{
  const f=await serve({demoRegistry:[{id:'demo-approved',bytes:await sample(),licenseEvidence:'synthetic-license-record'}]});try{const c=await issue(f.api),form=new FormData();form.set('demoId','demo-approved');form.set('name','Synthetic sample');
    const r=await upload(f.api,String(c.body.consentRecordId),'a',form);assert.equal(r.status,201);const body=await r.json() as {projectId:string;sourceKind:string};assert.equal(body.sourceKind,'licensed_demo');
    const details=JSON.parse((f.db.prepare("SELECT details_json FROM audit_events WHERE event_type='project.source.created'").get() as {details_json:string}).details_json) as Record<string,unknown>;
    assert.equal(details.sourceKind,'licensed_demo');assert.equal(details.licenseRegistryId,'demo-approved');assert.doesNotMatch(JSON.stringify(details),/synthetic-license-record|Synthetic sample/);
  }finally{await f.close();}
  const unconfigured=await serve({storageQuotaBytes:null});try{const c=await issue(unconfigured.api);const r=await fetch(unconfigured.api+'/projects',{method:'POST',headers:{authorization:'Bearer a','X-Form-Consent-Id':String(c.body.consentRecordId),'content-type':'text/plain'},body:'must not parse'});
    assert.equal(r.status,503);assert.equal((await r.json() as {code:string}).code,'STORAGE_QUOTA_UNAVAILABLE');assert.equal((unconfigured.db.prepare('SELECT count(*) n FROM projects').get() as {n:number}).n,0);
  }finally{await unconfigured.close();}
});

test('project service refuses to label bytes as a licensed demo unless they match its registry',async()=>{
  const registryBytes=await sample(),f=await serve({demoRegistry:[{id:'demo-approved',bytes:registryBytes,licenseEvidence:'synthetic-license-record'}]});try{
    const c=await issue(f.api),service=createProjectService({db:f.db,consentCatalog:catalog,storageQuotaBytes:20_000_000,demoRegistry:[{id:'demo-approved',bytes:registryBytes,licenseEvidence:'synthetic-license-record'}]});
    const fake=await sharp({create:{width:13,height:7,channels:4,background:'#00ff00'}}).png().toBuffer();
    await assert.rejects(()=>service.create('owner-a',String(c.body.consentRecordId),fake,'counterfeit','licensed_demo','demo-approved'),e=>e instanceof ProjectError&&e.code==='DEMO_UNAVAILABLE');
    await assert.rejects(()=>service.create('owner-a',String(c.body.consentRecordId),registryBytes,'counterfeit','source_guess' as never),e=>e instanceof ProjectError&&e.code==='INVALID_SOURCE_KIND');
    assert.equal((f.db.prepare('SELECT count(*) n FROM projects').get() as {n:number}).n,0);
  }finally{await f.close();}
});

test('the 50-project limit is checked before multipart data is parsed',async()=>{
  const f=await serve();try{const c=await issue(f.api),now=new Date().toISOString();for(let i=0;i<50;i++)f.db.prepare('INSERT INTO projects(id,owner_id,created_at) VALUES (?,?,?)').run(randomUUID(),'owner-a',now);
    const r=await fetch(f.api+'/projects',{method:'POST',headers:{authorization:'Bearer a','X-Form-Consent-Id':String(c.body.consentRecordId),'content-type':'text/plain'},body:'must not parse'});
    assert.equal(r.status,409);assert.equal((await r.json() as {code:string}).code,'QUOTA_EXCEEDED');assert.equal((f.db.prepare('SELECT count(*) n FROM projects').get() as {n:number}).n,50);
  }finally{await f.close();}
});

test('quota calculation fails closed on non-integer stored byte counts without exposing SQL errors',async()=>{
  const f=await serve();try{const now=new Date().toISOString();f.db.prepare('INSERT INTO projects(id,owner_id,created_at) VALUES (?,?,?)').run('corrupt-project','owner-a',now);
    f.db.prepare("INSERT INTO assets(id,owner_id,project_id,kind,mime,bytes,width,height,digest,storage_key,created_at,private_bytes) VALUES ('corrupt-asset','owner-a','corrupt-project','temporary','application/octet-stream',1.5,NULL,NULL,?, 'safe-key', ?, NULL)").run('a'.repeat(64),now);
    const c=await issue(f.api);const r=await fetch(f.api+'/projects',{method:'POST',headers:{authorization:'Bearer a','X-Form-Consent-Id':String(c.body.consentRecordId),'content-type':'text/plain'},body:'must not parse'});
    assert.equal(r.status,503);const body=await r.json() as {code:string;message:string};assert.equal(body.code,'QUOTA_STATE_INVALID');assert.doesNotMatch(JSON.stringify(body),/SQL|corrupt-asset|sqlite/i);
  }finally{await f.close();}
});

test('consent revoked during image normalization remains a 403 and commits no project data',async()=>{
  const f=await serve();try{
    const c=await issue(f.api),consentId=String(c.body.consentRecordId),service=createProjectService({db:f.db,consentCatalog:catalog,storageQuotaBytes:20_000_000});
    const pending=service.create('owner-a',consentId,await sample(),'Synthetic private project','user_upload');
    f.db.prepare('UPDATE consents SET revoked_at=? WHERE id=?').run(new Date().toISOString(),consentId);
    await assert.rejects(pending,e=>e instanceof Error&&(e as {code?:string;status?:number}).code==='CONSENT_INVALID'&&(e as {status?:number}).status===403);
    for(const table of ['projects','assets'])assert.equal((f.db.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n,0);
    assert.equal((f.db.prepare("SELECT count(*) n FROM audit_events WHERE event_type='project.source.created'").get() as {n:number}).n,0);
  }finally{await f.close();}
});

test('private asset fetch binds actor, project, storage locator, tombstones, and no-store response',async()=>{
  const f=await serve();try{const c=await issue(f.api);const created=await upload(f.api,String(c.body.consentRecordId));const body=await created.json() as {projectId:string;originalAssetId:string};
    const url=`${f.api}/assets/${body.originalAssetId}`;const ok=await fetch(url,{headers:{authorization:'Bearer a','X-Owner-Id':'owner-b'}});assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'private, no-store');assert.equal(ok.headers.get('content-type'),'image/png');
    assert.equal((await fetch(url,{headers:{authorization:'Bearer b'}})).status,404);assert.equal((await fetch(`${f.api}/projects/wrong-project/assets/${body.originalAssetId}`,{headers:{authorization:'Bearer a'}})).status,404);
    const key=(f.db.prepare('SELECT storage_key FROM assets WHERE id=?').get(body.originalAssetId) as {storage_key:string}).storage_key;
    f.db.prepare('UPDATE assets SET storage_key=? WHERE id=?').run('../escape',body.originalAssetId);const unsafe=await fetch(url,{headers:{authorization:'Bearer a'}});assert.equal(unsafe.status,404);assert.equal((await unsafe.json() as {code:string}).code,'ASSET_NOT_FOUND');
    f.db.prepare('UPDATE assets SET storage_key=? WHERE id=?').run(key,body.originalAssetId);
    f.db.prepare('UPDATE projects SET deleted_at=? WHERE id=?').run(new Date().toISOString(),body.projectId);assert.equal((await fetch(url,{headers:{authorization:'Bearer a'}})).status,404);
  }finally{await f.close();}
});

test('temporary assets are denied by public reads before they can be returned',async()=>{
  const f=await serve();try{
    const c=await issue(f.api),created=await upload(f.api,String(c.body.consentRecordId));
    const body=await created.json() as {projectId:string;originalAssetId:string;displayAssetId:string};assert.equal(created.status,201);
    f.db.prepare("UPDATE assets SET kind='temporary' WHERE id=? AND project_id=?").run(body.displayAssetId,body.projectId);
    const project=f.db.prepare('SELECT original_asset_id FROM projects WHERE id=?').get(body.projectId) as {original_asset_id:string};assert.equal(project.original_asset_id,body.originalAssetId);
    const denied=await fetch(`${f.api}/assets/${body.displayAssetId}`,{headers:{authorization:'Bearer a'}});assert.equal(denied.status,404);
    const service=createProjectService({db:f.db,consentCatalog:catalog,storageQuotaBytes:20_000_000});
    await assert.rejects(()=>service.readAsset('owner-a',body.projectId,body.displayAssetId),e=>e instanceof Error&&(e as {code?:string}).code==='ASSET_NOT_FOUND');
    await assert.rejects(()=>service.readAssetById('owner-a',body.displayAssetId),e=>e instanceof Error&&(e as {code?:string}).code==='ASSET_NOT_FOUND');
    assert.equal(service.canSendAsset('owner-a',body.projectId,body.displayAssetId),false);
  }finally{await f.close();}
});

test('legacy SQL reader validates opaque identity and derived owner/project before returning migrated bytes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'form-f07-legacy-')),sourcePath=join(dir,'source.sqlite'),backupPath=join(dir,'backup.sqlite'),outputPath=join(dir,'v3.sqlite');let db:DatabaseSync|undefined,server:Server|undefined;
  try{const cookie='synthetic-legacy-cookie',legacyProject='project-old',legacyImage='image-old',bytes=await sample();const legacy=new DatabaseSync(sourcePath);
    legacy.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY,state TEXT NOT NULL); CREATE TABLE images (id TEXT PRIMARY KEY,owner TEXT NOT NULL,project_id TEXT NOT NULL,data BLOB NOT NULL); CREATE TABLE reports (id TEXT PRIMARY KEY,owner TEXT NOT NULL,task_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL)');
    legacy.prepare('INSERT INTO sessions VALUES (?,?)').run(cookie,JSON.stringify({credits:0,reservedCredits:0,projects:[{id:legacyProject,originalUrl:`/api/images/${legacyImage}`,versions:[]}]}));legacy.prepare('INSERT INTO images VALUES (?,?,?,?)').run(legacyImage,cookie,legacyProject,bytes);legacy.close();
    migrateLegacyDatabase({inputPath:sourcePath,backupPath,outputPath,apply:true});db=new DatabaseSync(outputPath);db.exec('PRAGMA foreign_keys=ON');
    const ownerId=`legacy-owner-${sha(`form:v2:legacy-owner\0${cookie}`).slice(0,24)}`,projectId=(db.prepare('SELECT id FROM projects WHERE owner_id=?').get(ownerId) as {id:string}).id,assetId=(db.prepare("SELECT id FROM assets WHERE owner_id=? AND project_id=? AND kind='original'").get(ownerId,projectId) as {id:string}).id;
    db.prepare('INSERT INTO users(id,created_at) VALUES (?,?)').run('other-owner',new Date().toISOString());
    const app=express();app.use('/api/v2',createProjectsRouter({db,actorResolver:async req=>req.get('authorization')==='Bearer legacy'?ownerId:null,consentCatalog:catalog,storageQuotaBytes:20_000_000}));const live=app.listen(0,'127.0.0.1');server=live;await new Promise<void>(resolve=>live.once('listening',resolve));const a=live.address();assert.ok(a&&typeof a!=='string');
    const url=`http://127.0.0.1:${a.port}/api/v2/assets/${assetId}`;const result=await fetch(url,{headers:{authorization:'Bearer legacy'}});assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'image/png');assert.doesNotMatch(await result.text(),/synthetic-legacy-cookie/);
    db.prepare('UPDATE identities SET user_id=? WHERE user_id=?').run('other-owner',ownerId);const denied=await fetch(url,{headers:{authorization:'Bearer legacy'}});assert.equal(denied.status,404);assert.doesNotMatch(await denied.text(),/synthetic-legacy-cookie/);
  }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));db?.close();rmSync(dir,{recursive:true,force:true});}
});
