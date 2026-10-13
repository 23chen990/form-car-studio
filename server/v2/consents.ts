import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

export type ConsentPurposes={photoRights:string;uploadStorage:string;sharing:string};
export type ConsentPolicy={id:string;version:string;providerId:string;purposes:ConsentPurposes};
export type ConsentCatalog={providers:readonly string[];policies:readonly ConsentPolicy[]};
export const EMPTY_CONSENT_CATALOG:ConsentCatalog=Object.freeze({providers:Object.freeze([]),policies:Object.freeze([])});
export class ConsentError extends Error{constructor(readonly code:string,readonly status=403){super(code);this.name='ConsentError';}}
const safe=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function published(catalog:ConsentCatalog,policyId:unknown):ConsentPolicy{
  if(!catalog||!Array.isArray(catalog.providers)||!Array.isArray(catalog.policies)||!catalog.policies.length)throw new ConsentError('CONSENT_UNAVAILABLE',503);
  const matches=catalog.policies.filter(p=>p.id===policyId);
  if(matches.length!==1)throw new ConsentError('CONSENT_UNAVAILABLE',503);
  const p=matches[0];if(!safe(p.id)||!safe(p.version)||!safe(p.providerId)||!catalog.providers.includes(p.providerId)||
    !p.purposes||!safe(p.purposes.photoRights)||!safe(p.purposes.uploadStorage)||!safe(p.purposes.sharing)||
    new Set(Object.values(p.purposes)).size!==3)throw new ConsentError('CONSENT_UNAVAILABLE',503);
  return p;
}
function ownerExists(db:DatabaseSync,ownerId:string){return !!db.prepare('SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL').get(ownerId);}
function transaction<T>(db:DatabaseSync,work:()=>T):T{db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}

/** Server configuration, never request data, defines published policies, processors and purpose IDs. */
export function createConsentService(db:DatabaseSync,catalog:ConsentCatalog=EMPTY_CONSENT_CATALOG){
  function active(id:string,ownerId:string,requireSharing=false){
    if(!safe(id)||!safe(ownerId)||!ownerExists(db,ownerId))throw new ConsentError('CONSENT_INVALID');
    const row=db.prepare('SELECT owner_id,policy_version,purposes_json,provider_id,revoked_at FROM consents WHERE id=?').get(id) as
      {owner_id:string;policy_version:string;purposes_json:string;provider_id:string;revoked_at:string|null}|undefined;
    if(!row||row.owner_id!==ownerId||row.revoked_at!==null)throw new ConsentError('CONSENT_INVALID');
    const policies=catalog.policies.filter(p=>p.version===row.policy_version&&p.providerId===row.provider_id);
    if(policies.length!==1||!catalog.providers.includes(row.provider_id))throw new ConsentError('CONSENT_INVALID');
    const p=published(catalog,policies[0].id);let purposes:unknown;
    try{purposes=JSON.parse(row.purposes_json);}catch{throw new ConsentError('CONSENT_INVALID');}
    const base=[p.purposes.photoRights,p.purposes.uploadStorage],withSharing=[...base,p.purposes.sharing];
    if(!equal(purposes,base)&&!equal(purposes,withSharing)||requireSharing&&!equal(purposes,withSharing))throw new ConsentError('CONSENT_INVALID');
    return {id,ownerId,policyId:p.id,policyVersion:p.version,providerId:p.providerId,purposes:purposes as string[],sharing:equal(purposes,withSharing)};
  }
  return Object.freeze({
    issue(ownerId:string,input:{policyId:unknown;acknowledgePhotoRights:unknown;acknowledgeUploadStorage:unknown;acknowledgeSharing:unknown}){
      if(!safe(ownerId)||!ownerExists(db,ownerId))throw new ConsentError('AUTH_REQUIRED',401);
      if(input.acknowledgePhotoRights!==true||input.acknowledgeUploadStorage!==true||typeof input.acknowledgeSharing!=='boolean')throw new ConsentError('CONSENT_ACK_REQUIRED',400);
      const p=published(catalog,input.policyId),purposes=[p.purposes.photoRights,p.purposes.uploadStorage];
      if(input.acknowledgeSharing)purposes.push(p.purposes.sharing);
      const id=randomUUID(),createdAt=new Date().toISOString();
      transaction(db,()=>{if(!ownerExists(db,ownerId))throw new ConsentError('AUTH_REQUIRED',401);
        db.prepare('INSERT INTO consents(id,owner_id,policy_version,purposes_json,provider_id,created_at,revoked_at) VALUES (?,?,?,?,?,?,NULL)')
          .run(id,ownerId,p.version,JSON.stringify(purposes),p.providerId,createdAt);});
      return {consentRecordId:id};
    },
    assertUpload(id:string,ownerId:string){return active(id,ownerId,false);},
    /** Exact current policy/provider/purpose scope; callers must still match it to their operation. */
    assertSharing(id:string,ownerId:string){return active(id,ownerId,true);},
  });
}
