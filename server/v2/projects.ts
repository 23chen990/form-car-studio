import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {createDisplayAsset,IMAGE_LIMITS,ImageError,normalizeInput,type ImageAsset} from './images.js';
import {AssetError,assetInsertMetadata,readOwnedAsset,type AssetReader,type AssetRow,type StorageLocator} from './assets.js';
import {ConsentError,createConsentService,type ConsentCatalog,EMPTY_CONSENT_CATALOG} from './consents.js';

export const PROJECT_LIMIT=50;
export const MAX_MULTIPART_BYTES=IMAGE_LIMITS.inputBytes+64*1024;
export type SourceKind='user_upload'|'licensed_demo';
export type DemoSample={id:string;bytes:Uint8Array;licenseEvidence:string};
type SourceCreatedDetails={eventVersion:1;projectId:string;sourceKind:SourceKind;sourceSha256:string;storedOriginalSha256:string;normalizerVersion:string;consentId:string;licenseRegistryId?:string};
export type ProjectOptions={db:DatabaseSync;consentCatalog?:ConsentCatalog;storageQuotaBytes?:number|null;demoRegistry?:readonly DemoSample[]};
export class ProjectError extends Error{constructor(readonly code:string,readonly status=400){super(code);this.name='ProjectError';}}
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const safeId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const safeImageCodes=new Set(['INPUT_EMPTY','INPUT_BYTE_LIMIT','INPUT_UNSUPPORTED_FORMAT','INPUT_UNREADABLE','INPUT_PIXEL_LIMIT','INPUT_UNSUPPORTED_PRECISION','INPUT_NORMALIZED_BYTE_LIMIT','ANIMATION_UNSUPPORTED','OUTPUT_EMPTY','OUTPUT_BYTE_LIMIT','OUTPUT_UNSUPPORTED_FORMAT','OUTPUT_UNREADABLE','OUTPUT_PIXEL_LIMIT','OUTPUT_UNSUPPORTED_PRECISION','OUTPUT_NORMALIZED_BYTE_LIMIT','INVALID_DISPLAY_SIZE','MASTER_DIGEST_MISMATCH','MASTER_METADATA_MISMATCH']);
function ownerExists(db:DatabaseSync,owner:string){return safeId(owner)&&!!db.prepare('SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL').get(owner);}
function activeProject(db:DatabaseSync,owner:string,project:string){return !!db.prepare('SELECT 1 FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.id=? AND p.owner_id=? AND p.deleted_at IS NULL AND u.deleted_at IS NULL').get(project,owner);}
function transaction<T>(db:DatabaseSync,fn:()=>T):T{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}}
function useCount(db:DatabaseSync,owner:string){
  try{const n=(db.prepare('SELECT count(*) n FROM projects WHERE owner_id=?').get(owner) as {n:number}).n;if(!Number.isSafeInteger(n)||n<0)throw new ProjectError('QUOTA_STATE_INVALID',503);return n;}
  catch(error){if(error instanceof ProjectError)throw error;throw new ProjectError('QUOTA_STATE_INVALID',503);}
}
function usedBytes(db:DatabaseSync,owner:string){
  try{const bad=db.prepare("SELECT 1 FROM assets WHERE owner_id=? AND (typeof(bytes)<>'integer' OR bytes<0 OR bytes>9007199254740991) LIMIT 1").get(owner);
    if(bad)throw new ProjectError('QUOTA_STATE_INVALID',503);const n=(db.prepare('SELECT coalesce(sum(bytes),0) n FROM assets WHERE owner_id=?').get(owner) as {n:number}).n;
    if(!Number.isSafeInteger(n)||n<0)throw new ProjectError('QUOTA_STATE_INVALID',503);return n;
  }catch(error){if(error instanceof ProjectError)throw error;throw new ProjectError('QUOTA_STATE_INVALID',503);}
}
function quota(db:DatabaseSync,owner:string,cap:number|null|undefined,additional=0){
  if(!Number.isSafeInteger(cap)||cap===null||cap===undefined||cap<1)throw new ProjectError('STORAGE_QUOTA_UNAVAILABLE',503);
  if(!Number.isSafeInteger(additional)||additional<0)throw new ProjectError('QUOTA_STATE_INVALID',503);
  const used=usedBytes(db,owner),count=useCount(db,owner);if(!Number.isSafeInteger(used+additional))throw new ProjectError('QUOTA_STATE_INVALID',503);
  if(count>=PROJECT_LIMIT||used+additional>cap||additional===0&&used>=cap)throw new ProjectError('QUOTA_EXCEEDED',409);
}
function privateAsset(db:DatabaseSync,id:string,owner:string,project:string){return db.prepare(`SELECT a.id,a.owner_id,a.project_id,a.kind,a.mime,a.bytes,a.width,a.height,a.digest,a.storage_key,a.created_at
  FROM assets a JOIN projects p ON p.id=a.project_id AND p.owner_id=a.owner_id JOIN users u ON u.id=a.owner_id
  WHERE a.id=? AND a.owner_id=? AND a.project_id=? AND p.deleted_at IS NULL AND u.deleted_at IS NULL`).get(id,owner,project) as AssetRow|undefined;}
function legacyOwner(cookie:string){return `legacy-owner-${hash(`form:v2:legacy-owner\0${cookie}`).slice(0,24)}`;}
function legacyProject(owner:string,project:string){return `legacy-project-${hash(`${owner}:${project}`).slice(0,24)}`;}
function validLegacyMapping(db:DatabaseSync,row:AssetRow){
  const match=/^legacy:\/\/(legacy-owner-[a-f0-9]{24})\/([A-Za-z0-9_-]{1,128})$/.exec(row.storage_key);
  if(!match||match[1]!==row.owner_id)return false;
  const image=db.prepare('SELECT id,owner,project_id FROM images WHERE id=?').get(match[2]) as {id:string;owner:string;project_id:string}|undefined;
  if(!image||image.id!==match[2]||legacyOwner(image.owner)!==row.owner_id||legacyProject(row.owner_id,image.project_id)!==row.project_id)return false;
  return !!db.prepare("SELECT 1 FROM identities WHERE user_id=? AND provider='legacy_cookie' AND subject=?").get(row.owner_id,hash(image.owner));
}

/** SQL adapter for F06: every locator is rebound to the persisted asset and actor scope. */
export function createSqlAssetReader(db:DatabaseSync):AssetReader{
  return {
    canReadProject:async(owner,project)=>activeProject(db,owner,project),
    findOwned:async(id,owner,project)=>{const row=privateAsset(db,id,owner,project);return row&&row.storage_key.startsWith('legacy://')&&!validLegacyMapping(db,row)?null:row??null;},
    readBytes:async(locator:StorageLocator)=>{
      if(locator.kind==='private'){
        const row=db.prepare(`SELECT a.private_bytes FROM assets a JOIN projects p ON p.id=a.project_id AND p.owner_id=a.owner_id JOIN users u ON u.id=a.owner_id
          WHERE a.id=? AND a.owner_id=? AND a.project_id=? AND a.storage_key=? AND p.deleted_at IS NULL AND u.deleted_at IS NULL`)
          .get(locator.assetId,locator.ownerId,locator.projectId,locator.storageKey) as {private_bytes:Uint8Array|null}|undefined;
        if(!row?.private_bytes)throw new Error('asset read denied');return Buffer.from(row.private_bytes);
      }
      if(locator.kind!=='legacy')throw new Error('asset read denied');
      const stored=db.prepare(`SELECT 1 FROM assets a JOIN projects p ON p.id=a.project_id AND p.owner_id=a.owner_id JOIN users u ON u.id=a.owner_id
        WHERE a.id=? AND a.owner_id=? AND a.project_id=? AND a.storage_key=? AND a.kind IN ('original','master') AND p.deleted_at IS NULL AND u.deleted_at IS NULL`)
        .get(locator.assetId,locator.ownerId,locator.projectId,locator.storageKey);
      if(!stored||locator.storageKey!==`legacy://${locator.ownerId}/${locator.legacyImageId}`)throw new Error('asset read denied');
      const row=db.prepare('SELECT id,owner,project_id,data FROM images WHERE id=?').get(locator.legacyImageId) as {id:string;owner:string;project_id:string;data:Uint8Array}|undefined;
      if(!row||row.id!==locator.legacyImageId||legacyOwner(row.owner)!==locator.ownerId||legacyProject(locator.ownerId,row.project_id)!==locator.projectId)throw new Error('asset read denied');
      const identity=db.prepare("SELECT 1 FROM identities WHERE user_id=? AND provider='legacy_cookie' AND subject=?").get(locator.ownerId,hash(row.owner));
      if(!identity)throw new Error('asset read denied');
      return Buffer.from(row.data);
    }
  };
}

export function createProjectService(options:ProjectOptions){
  const {db}=options,catalog=options.consentCatalog??EMPTY_CONSENT_CATALOG,consents=createConsentService(db,catalog),cap=options.storageQuotaBytes??null;
  function validateSource(raw:Buffer,sourceKind:unknown,licenseRegistryId?:string){
    if(sourceKind==='licensed_demo'){const approved=sample(licenseRegistryId??'');if(!approved||!approved.bytes.equals(raw))throw new ProjectError('DEMO_UNAVAILABLE',403);}
    else if(sourceKind!=='user_upload'||licenseRegistryId!==undefined)throw new ProjectError('INVALID_SOURCE_KIND',400);
  }
  function admit(owner:string,consentId:string){
    if(!ownerExists(db,owner))throw new ProjectError('AUTH_REQUIRED',401);
    consents.assertUpload(consentId,owner);quota(db,owner,cap);
  }
  async function create(owner:string,consentId:string,raw:Buffer,name:string,sourceKind:SourceKind,licenseRegistryId?:string){
    admit(owner,consentId);
    if(!Buffer.isBuffer(raw)||raw.length===0||raw.length>IMAGE_LIMITS.inputBytes)throw new ProjectError('UPLOAD_INVALID',413);
    validateSource(raw,sourceKind,licenseRegistryId);
    let original:ImageAsset,display:ImageAsset;
    try{original=await normalizeInput(raw);display=await createDisplayAsset(original);}catch(error){throw new ProjectError(error instanceof ImageError&&safeImageCodes.has(error.code)?error.code:'INVALID_IMAGE',422);}
    const projectId=randomUUID(),originalId=randomUUID(),displayId=randomUUID(),createdAt=new Date().toISOString();
    const originalMeta=assetInsertMetadata({id:originalId,ownerId:owner,projectId,kind:'original',storageKey:randomBytes(24).toString('hex'),createdAt},original);
    const displayMeta=assetInsertMetadata({id:displayId,ownerId:owner,projectId,kind:'display',storageKey:randomBytes(24).toString('hex'),createdAt},display);
    try{return transaction(db,()=>{
      if(!ownerExists(db,owner))throw new ProjectError('AUTH_REQUIRED',401);
      consents.assertUpload(consentId,owner);validateSource(raw,sourceKind,licenseRegistryId);quota(db,owner,cap,original.bytes.length+display.bytes.length);
      const projectName=name.trim().slice(0,120)||'New project';
      db.prepare('INSERT INTO projects(id,owner_id,name,created_at,deleted_at,original_asset_id) VALUES (?,?,?,?,NULL,NULL)').run(projectId,owner,projectName,createdAt);
      const insert=db.prepare(`INSERT INTO assets(id,owner_id,project_id,kind,mime,bytes,width,height,digest,storage_key,created_at,private_bytes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      insert.run(originalMeta.id,owner,projectId,'original',originalMeta.mime,originalMeta.bytes,originalMeta.width,originalMeta.height,originalMeta.digest,originalMeta.storage_key,createdAt,original.bytes);
      insert.run(displayMeta.id,owner,projectId,'display',displayMeta.mime,displayMeta.bytes,displayMeta.width,displayMeta.height,displayMeta.digest,displayMeta.storage_key,createdAt,display.bytes);
      db.prepare('UPDATE projects SET original_asset_id=? WHERE id=? AND owner_id=?').run(originalId,projectId,owner);
      const details:SourceCreatedDetails={eventVersion:1,projectId,sourceKind,sourceSha256:original.sourceSha256,storedOriginalSha256:original.sha256,normalizerVersion:original.normalizerVersion,consentId,...(licenseRegistryId?{licenseRegistryId}:{})};
      db.prepare("INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES (?,?, 'project.source.created',?,?)").run(randomUUID(),owner,JSON.stringify(details),createdAt);
      return {projectId,originalAssetId:originalId,displayAssetId:displayId,sourceKind};
    });}catch(error){if(error instanceof ProjectError||error instanceof AssetError||error instanceof ConsentError)throw error;throw new ProjectError('PROJECT_CREATE_FAILED',500);}
  }
  function issueConsent(owner:string,input:{policyId:unknown;acknowledgePhotoRights:unknown;acknowledgeUploadStorage:unknown;acknowledgeSharing:unknown}){return consents.issue(owner,input);}
  async function readAsset(owner:string,project:string,id:string){
    if(!ownerExists(db,owner)||!activeProject(db,owner,project))throw new AssetError('ASSET_NOT_FOUND');
    const row=privateAsset(db,id,owner,project);if(!row||row.kind==='temporary'||row.storage_key.startsWith('legacy://')&&!validLegacyMapping(db,row))throw new AssetError('ASSET_NOT_FOUND');
    return readOwnedAsset(createSqlAssetReader(db),id,owner,project);
  }
  async function readAssetById(owner:string,id:string){
    if(!ownerExists(db,owner))throw new AssetError('ASSET_NOT_FOUND');
    const row=db.prepare(`SELECT a.project_id,a.kind FROM assets a JOIN projects p ON p.id=a.project_id AND p.owner_id=a.owner_id JOIN users u ON u.id=a.owner_id
      WHERE a.id=? AND a.owner_id=? AND p.deleted_at IS NULL AND u.deleted_at IS NULL`).get(id,owner) as {project_id:string;kind:AssetRow['kind']}|undefined;
    if(!row||row.kind==='temporary')throw new AssetError('ASSET_NOT_FOUND');return {projectId:row.project_id,result:await readAsset(owner,row.project_id,id)};
  }
  function canSendAsset(owner:string,project:string,id:string){const row=privateAsset(db,id,owner,project);return ownerExists(db,owner)&&!!row&&row.kind!=='temporary'&&activeProject(db,owner,project)&&(!row.storage_key.startsWith('legacy://')||validLegacyMapping(db,row));}
  function preflight(owner:string,consentId:string){admit(owner,consentId);}
  function sample(id:string){const entry=options.demoRegistry?.find(x=>x.id===id&&typeof x.licenseEvidence==='string'&&x.licenseEvidence.trim().length>0&&x.bytes instanceof Uint8Array);
    return entry?{bytes:Buffer.from(entry.bytes),licenseRegistryId:entry.id}:null;}
  return Object.freeze({issueConsent,preflight,create,readAsset,readAssetById,canSendAsset,sample,storageQuotaBytes:cap});
}

