import {createHash,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {AssetError,readGenerationBase,type AssetRow} from './assets.js';
import {ConsentError,createConsentService,EMPTY_CONSENT_CATALOG,type ConsentCatalog} from './consents.js';
import {createSqlAssetReader,readAuthorizedLegacyBytes,type DemoSample,type SourceKind} from './projects.js';
import {ProfileError,profileCapabilities,snapshotProfile,type ProviderProfile} from './provider-profile.js';
import {canonicalJson,ContractError,FIELDS,COLORS,WHEEL_COLORS,FINISHES,WHEEL_DESIGNS,STYLES,parseEditRequest,resolveEdits,semanticDigest,type EditRequest,type Field,type ResolvedEdit,type SourceRef} from '../../shared/v2/edit-plan.js';
import {expandPreset,PRESET_VERSION} from './presets.js';

export type AllowedSourceKind='user_upload'|'unknown';
export interface PlanProfileCandidate {profile:ProviderProfile;providerId:string}
export interface PlanConfiguration {
  /** Explicitly false by default. No provider facts or budget are present in this repository. */
  liveEnabled?:boolean;
  /** F08 requires one server-selected candidate; clients never select or override it. */
  liveCandidates?:readonly string[];
  profiles?:readonly PlanProfileCandidate[];
  policyVersion?:string;
  /** Must exactly match the published purpose recorded in sharing consent. */
  requiredGenerationPurpose?:string;
  budget?:{maxSupplierCostMicrosUSD:number|null};
  sourcePolicy?:{version:string;allowedKinds:readonly AllowedSourceKind[]};
  /** Offline licensed-sample quotes are a separate opt-in mode with no provider or sharing consent. */
  demoEnabled?:boolean;
  demoPolicy?:{version:string;registry:readonly DemoSample[];fields?:readonly Field[];originalReference?:boolean};
}
export interface PlanOptions {
  db:DatabaseSync;
  consentCatalog?:ConsentCatalog|null;
  config?:PlanConfiguration;
  /** Dynamic configuration hook lets shutdown/config changes be rechecked after image reads. */
  getConfig?:()=>PlanConfiguration;
  clock?:()=>Date;
  id?:()=>string;
}

export interface PlanImageReference {
  assetId:string;assetKind:'original'|'master';persistedSha256:string;rawSha256:string;canonicalSha256:string;pixelSha256:string;
  bytes:number;width:number;height:number;rawGeometry:{width:number;height:number};canonicalGeometry:{width:number;height:number};
  normalizerVersion:string;sourceFormat:string;sourceOrientation:number|null;
}
export interface ProjectSourceEvidence {
  kind:SourceKind|'unknown';sourceSha256?:string;storedOriginalSha256?:string;normalizerVersion?:string;sourceConsentId?:string;licenseRegistryId?:string;
}
export interface PlanSemantic {
  schemaVersion:1;ownerId:string;projectId:string;walletScope:'live'|'demo';executionMode:'live'|'licensed_demo';configurationDigest:string;
  generationPurpose:string|null;supplierExposureMicrosUSD:number;
  source:{kind:'original'|'version';versionId?:string;assetId:string;assetKind:'original'|'master';persistedSha256:string;rawSha256:string;canonicalSha256:string;pixelSha256:string;bytes:number;width:number;height:number;rawGeometry:{width:number;height:number};canonicalGeometry:{width:number;height:number};normalizerVersion:string;sourceFormat:string;sourceOrientation:number|null};
  originalReference?:PlanImageReference;
  projectSource:ProjectSourceEvidence;
  requestEdits:EditRequest;
  desiredRecipe:{changes:readonly ResolvedEdit[];preserve:readonly Field[];inherited:{styleId:string|null;verification:'unverified'|'unknown'|'none';requested:readonly ResolvedEdit[];preserve:readonly Field[]}};
  observedRecipe:{status:'unknown';fields:Readonly<Record<string,never>>};
  presetVersion:string|null;
  capabilities:{enabled:true;fields:readonly Field[];originalReference:boolean};
  supplier:{supplierProfileId:string;profileVersion:string;providerId:string;protocol:ProviderProfile['protocol'];endpoint:string;model:string;templateVersion:string;output:ProviderProfile['output'];maxSupplierCostMicrosUSD:number;approvedBudgetMicrosUSD:number;qualityEvidence:string;timeoutMs:number;maxInputBytes:number;maxOutputBytes:number;maxResponseBytes:number}|null;
  consent:{recordId:string;policyId:string;policyVersion:string;providerId:string|null;purposes:readonly string[]};
  policyVersion:string;sourcePolicyVersion:string|null;demoPolicyVersion:string|null;userCostUnits:1;outputCount:1;
}
export interface PlanSnapshot {schemaVersion:1;planId:string;createdAt:string;expiresAt:string;semantic:PlanSemantic;planDigest:string}

export class PlanError extends Error {constructor(readonly code:string,readonly status=422){super(code);this.name='PlanError';}}
const safeId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const token=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
function checkProviderInputSizes(supplier:PlanSemantic['supplier'],source:Buffer,reference:Buffer|null){
  if(supplier&&(source.length>supplier.maxInputBytes||(reference&&reference.length>supplier.maxInputBytes)))
    throw new PlanError('INPUT_TOO_LARGE_FOR_PROVIDER',422);
}
const unavailable=()=>new PlanError('PLAN_UNAVAILABLE',503);
const invalidSource=()=>new PlanError('SOURCE_NOT_FOUND',404);
function cloneConsentCatalog(raw:ConsentCatalog|null|undefined):ConsentCatalog{
  if(!raw)return EMPTY_CONSENT_CATALOG;
  const providers=Array.isArray(raw.providers)?raw.providers.slice():[],policies=Array.isArray(raw.policies)?raw.policies.map(p=>Object.freeze({...p,purposes:p?.purposes?Object.freeze({...p.purposes}):p?.purposes})):[];
  return Object.freeze({providers:Object.freeze(providers),policies:Object.freeze(policies)});
}
function isPlain(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
function exactKeys(value:Record<string,unknown>,keys:readonly string[]){if(!Reflect.ownKeys(value).every(k=>typeof k==='string'&&keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))throw new PlanError('PLAN_ROW_INVALID',500);}
function deepFreeze<T>(value:T):T{
  if(ArrayBuffer.isView(value))return value;
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value as Record<string,unknown>))deepFreeze(child);Object.freeze(value);}
  return value;
}
function parseJsonClone(value:unknown){try{return JSON.parse(canonicalJson(value)) as unknown;}catch{throw new PlanError('PLAN_ROW_INVALID',500);}}
function freezeConsentCatalog(raw:ConsentCatalog){
  const policies=raw.policies.map(p=>({id:p.id,version:p.version,providerId:p.providerId,purposes:{photoRights:p.purposes?.photoRights,uploadStorage:p.purposes?.uploadStorage,sharing:p.purposes?.sharing}}));
  return deepFreeze({providers:[...raw.providers],policies});
}

interface NormalizedDemo {id:string;sourceSha256:string;licenseEvidenceHash:string;licensed:boolean}
interface NormalizedConfig {
  liveEnabled:boolean;liveCandidates:readonly string[];profiles:readonly PlanProfileCandidate[];policyVersion:string;requiredGenerationPurpose:string;
  budget:number;sourcePolicy:{version:string;allowedKinds:readonly AllowedSourceKind[]};
  demoEnabled:boolean;demoPolicyVersion:string;demoFields:readonly Field[];demoOriginalReference:boolean;demoRegistry:readonly NormalizedDemo[];fingerprint:string;
}
function normalizeConfig(raw:PlanConfiguration|undefined):NormalizedConfig{
  try{
    const source=raw??{},liveEnabled=source.liveEnabled===true;
    let candidates:PlanProfileCandidate[]=[],liveCandidates:string[]=[],policyVersion='',requiredGenerationPurpose='',budget=0,sourcePolicy={version:'',allowedKinds:[] as AllowedSourceKind[]};
    if(liveEnabled){
      if(!Array.isArray(source.liveCandidates)||source.liveCandidates.length!==1||!Array.isArray(source.profiles)||!source.budget||!source.sourcePolicy)throw unavailable();
      if(!token(source.policyVersion)||!token(source.requiredGenerationPurpose)||!token(source.sourcePolicy.version)||!Number.isSafeInteger(source.budget.maxSupplierCostMicrosUSD)||Number(source.budget.maxSupplierCostMicrosUSD)<1)throw unavailable();
      candidates=source.profiles.map(item=>{
        if(!isPlain(item)||!token(item.providerId))throw unavailable();
        const profile=snapshotProfile(item.profile);if(!profile.approvedForLive||profile.maxCostMicrosUSD===null||profile.qualityEvidence===null)throw unavailable();
        return {profile,providerId:item.providerId};
      });
      const ids=candidates.map(x=>x.profile.id);if(new Set(ids).size!==ids.length||typeof source.liveCandidates[0]!=='string'||!ids.includes(source.liveCandidates[0]))throw unavailable();
      const selected=candidates.find(x=>x.profile.id===source.liveCandidates![0]);if(!selected||Number(selected.profile.maxCostMicrosUSD)>Number(source.budget.maxSupplierCostMicrosUSD))throw unavailable();
      if(!Array.isArray(source.sourcePolicy.allowedKinds)||!source.sourcePolicy.allowedKinds.length||source.sourcePolicy.allowedKinds.some(x=>!['user_upload','unknown'].includes(x))||new Set(source.sourcePolicy.allowedKinds).size!==source.sourcePolicy.allowedKinds.length)throw unavailable();
      liveCandidates=[...source.liveCandidates];policyVersion=source.policyVersion;requiredGenerationPurpose=source.requiredGenerationPurpose;budget=Number(source.budget.maxSupplierCostMicrosUSD);sourcePolicy={version:source.sourcePolicy.version,allowedKinds:[...source.sourcePolicy.allowedKinds]};
    }
    const demoEnabled=source.demoEnabled===true;let demoPolicyVersion='',demoFields:Field[]=[],demoOriginalReference=false,demos:NormalizedDemo[]=[];
    if(demoEnabled){
      if(!source.demoPolicy||!token(source.demoPolicy.version)||!Array.isArray(source.demoPolicy.registry)||!source.demoPolicy.registry.length)throw unavailable();
      const configuredFields=source.demoPolicy.fields??[];
      if(!Array.isArray(configuredFields)||!configuredFields.length||configuredFields.some((f:unknown)=>!['bodyColor','wheelColor'].includes(String(f)))||new Set(configuredFields).size!==configuredFields.length||typeof (source.demoPolicy.originalReference??false)!=='boolean')throw unavailable();
      demos=source.demoPolicy.registry.map(entry=>{
        if(!entry||!token(entry.id)||!(entry.bytes instanceof Uint8Array)||entry.bytes.length<1||entry.bytes.length>10*1024*1024||typeof entry.licenseEvidence!=='string'||!entry.licenseEvidence.trim())throw unavailable();
        const bytes=Buffer.from(entry.bytes);return {id:entry.id,sourceSha256:hash(bytes),licenseEvidenceHash:hash(entry.licenseEvidence),licensed:true};
      });
      if(new Set(demos.map(x=>x.id)).size!==demos.length)throw unavailable();
      demoPolicyVersion=source.demoPolicy.version;demoFields=[...configuredFields];demoOriginalReference=source.demoPolicy.originalReference??false;
    }
    const clean={liveEnabled,liveCandidates,profiles:candidates,policyVersion,requiredGenerationPurpose,budget,sourcePolicy,demoEnabled,demoPolicyVersion,demoFields,demoOriginalReference,demoRegistry:demos};
    const fingerprint=hash(canonicalJson({liveEnabled,liveCandidates,profiles:candidates.map(x=>({providerId:x.providerId,profile:x.profile})),policyVersion,requiredGenerationPurpose,budget,sourcePolicy,demoEnabled,demoPolicyVersion,demoFields,demoOriginalReference,demoRegistry:demos.map(x=>({id:x.id,sourceSha256:x.sourceSha256,licenseEvidenceHash:x.licenseEvidenceHash,licensed:x.licensed}))}));
    return deepFreeze({...clean,fingerprint});
  }catch(error){if(error instanceof PlanError)throw error;throw unavailable();}
}
function selectedCandidate(config:NormalizedConfig){
  if(!config.liveEnabled||config.liveCandidates.length!==1)throw unavailable();
  const candidate=config.profiles.find(item=>item.profile.id===config.liveCandidates[0]);if(!candidate)throw unavailable();
  return candidate;
}

interface ProjectScope {id:string;ownerId:string;originalAssetId:string|null}
function activeProject(db:DatabaseSync,ownerId:string,projectId:string):ProjectScope{
  if(!safeId(ownerId)||!safeId(projectId))throw invalidSource();
  const row=db.prepare(`SELECT p.id,p.owner_id,p.original_asset_id FROM projects p JOIN users u ON u.id=p.owner_id
    WHERE p.id=? AND p.owner_id=? AND p.deleted_at IS NULL AND u.deleted_at IS NULL`).get(projectId,ownerId) as {id:string;owner_id:string;original_asset_id:string|null}|undefined;
  if(!row)throw new PlanError('PROJECT_NOT_FOUND',404);return {id:row.id,ownerId:row.owner_id,originalAssetId:row.original_asset_id};
}
function selectedAssetId(db:DatabaseSync,scope:ProjectScope,source:SourceRef):string{
  if(source.kind==='original'){if(!scope.originalAssetId)throw invalidSource();return scope.originalAssetId;}
  const row=db.prepare(`SELECT id,owner_id,project_id,master_asset_id FROM versions
    WHERE id=? AND owner_id=? AND project_id=?`).get(source.versionId,scope.ownerId,scope.id) as {id:string;owner_id:string;project_id:string;master_asset_id:string|null}|undefined;
  if(!row||!row.master_asset_id)throw invalidSource();return row.master_asset_id;
}
function selectedRecipeJson(db:DatabaseSync,scope:ProjectScope,source:SourceRef):string|null{
  if(source.kind==='original')return null;
  const row=db.prepare('SELECT recipe_json FROM versions WHERE id=? AND owner_id=? AND project_id=?').get(source.versionId,scope.ownerId,scope.id) as {recipe_json:string|null}|undefined;
  if(!row)throw invalidSource();return row.recipe_json;
}

type InheritedIntent=PlanSemantic['desiredRecipe']['inherited'];
const legacyChoices:Record<Field,readonly string[]>={bodyColor:COLORS,wheelColor:WHEEL_COLORS,bodyFinish:FINISHES,wheelDesign:WHEEL_DESIGNS};
function validInheritedIntent(value:unknown):value is InheritedIntent{
  if(!isPlain(value))return false;
  try{exactKeys(value,['styleId','verification','requested','preserve']);}catch{return false;}
  if(!(value.styleId===null||STYLES.includes(value.styleId as typeof STYLES[number]))||!['none','unknown','unverified'].includes(String(value.verification))||!Array.isArray(value.requested)||value.requested.some((x:unknown)=>!validChange(x))||!Array.isArray(value.preserve)||value.preserve.some((x:unknown)=>!FIELDS.includes(x as Field))||new Set(value.preserve).size!==value.preserve.length)return false;
  if(new Set((value.requested as ResolvedEdit[]).map(x=>x.field)).size!==value.requested.length||(value.requested as ResolvedEdit[]).some(x=>(value.preserve as Field[]).includes(x.field)))return false;
  if(value.verification==='none'&&(value.styleId!==null||value.requested.length||value.preserve.length)||value.verification==='unknown'&&(value.styleId!==null||value.requested.length||value.preserve.length))return false;
  return true;
}
function validDesiredRecipe(value:unknown):value is PlanSemantic['desiredRecipe']{
  if(!isPlain(value))return false;
  try{exactKeys(value,['changes','preserve','inherited']);}catch{return false;}
  return Array.isArray(value.changes)&&value.changes.every(validChange)&&new Set(value.changes.map((x:ResolvedEdit)=>x.field)).size===value.changes.length&&Array.isArray(value.preserve)&&value.preserve.every((x:unknown)=>FIELDS.includes(x as Field))&&new Set(value.preserve).size===value.preserve.length&&validInheritedIntent(value.inherited);
}
const historicalCapabilities:PlanSemantic['capabilities']={enabled:true,fields:FIELDS,originalReference:true};
function versionTwoIntent(raw:Record<string,unknown>):InheritedIntent|null{
  try{
    exactKeys(raw,['schemaVersion','requestEdits','desiredRecipe','observedRecipe','qualityAssessment']);
    if(raw.schemaVersion!==2||!isPlain(raw.observedRecipe)||!isPlain(raw.qualityAssessment))return null;
    exactKeys(raw.observedRecipe,['status','fields']);exactKeys(raw.qualityAssessment,['status']);
    if(raw.observedRecipe.status!=='unknown'||!isPlain(raw.observedRecipe.fields)||Reflect.ownKeys(raw.observedRecipe.fields).length!==0||raw.qualityAssessment.status!=='unassessed')return null;
    const request=parseEditRequest(raw.requestEdits),desired=raw.desiredRecipe;
    if(canonicalJson(request)!==canonicalJson(raw.requestEdits)||!validDesiredRecipe(desired))return null;
    const recomputed=combineRecipe(desired.inherited,resolveCurrentRecipe(request,historicalCapabilities).changes,request);
    if(canonicalJson(recomputed)!==canonicalJson(desired))return null;
    return {styleId:desired.inherited.styleId??(request.operation==='explore'?request.styleId??null:null),verification:'unverified',requested:desired.changes.map(edit=>({...edit})),preserve:[...desired.preserve]};
  }catch{return null;}
}
function inheritedIntent(recipeJson:string|null):InheritedIntent{
  if(recipeJson===null)return {styleId:null,verification:'none',requested:[],preserve:[]};
  let raw:unknown;try{raw=JSON.parse(recipeJson);}catch{return {styleId:null,verification:'unknown',requested:[],preserve:[]};}
  if(!isPlain(raw))return {styleId:null,verification:'unknown',requested:[],preserve:[]};
  if(raw.schemaVersion===2){const intent=versionTwoIntent(raw);return intent??{styleId:null,verification:'unknown',requested:[],preserve:[]};}
  if(raw.source!=='legacy'||raw.verification!=='unverified')return {styleId:null,verification:'unknown',requested:[],preserve:[]};
  const styleId=typeof raw.styleId==='string'&&STYLES.includes(raw.styleId as typeof STYLES[number])?raw.styleId:null;
  const verification='unverified' as const;
  const selected:Partial<Record<Field,{action:'set';value:string}|{action:'preserve'}>>={};
  if(styleId){for(const [field,edit] of Object.entries(expandPreset(styleId).edits) as Array<[Field,ResolvedEdit|{action:'preserve'}]>){selected[field]=edit.action==='preserve'?{action:'preserve'}:{action:'set',value:edit.value!};}}
  if(isPlain(raw.target)){
    const sourceToField:Record<string,Field>={bodyColor:'bodyColor',wheelColor:'wheelColor',finish:'bodyFinish',bodyFinish:'bodyFinish',wheelDesign:'wheelDesign'};
    for(const [legacyField,value] of Object.entries(raw.target)){const field=sourceToField[legacyField];if(!field)continue;
      if(value==='keep')selected[field]={action:'preserve'};
      else if(typeof value==='string'&&legacyChoices[field].includes(value))selected[field]={action:'set',value};
    }
  }
  const requested:ResolvedEdit[]=[],preserve:Field[]=[];
  for(const field of FIELDS){const edit=selected[field];if(!edit)continue;if(edit.action==='preserve')preserve.push(field);else requested.push({field,action:'set',value:edit.value});}
  return {styleId,verification,requested,preserve};
}
function combineRecipe(inherited:InheritedIntent,current:readonly ResolvedEdit[],request:EditRequest):PlanSemantic['desiredRecipe']{
  const changes=new Map<Field,ResolvedEdit>();
  for(const item of inherited.requested)changes.set(item.field,{...item});
  for(const field of FIELDS)if(request.edits[field]?.action==='preserve')changes.delete(field);
  for(const item of current)changes.set(item.field,{...item});
  const ordered=FIELDS.flatMap(field=>{const item=changes.get(field);return item?[item]:[];});
  return {changes:ordered,preserve:FIELDS.filter(field=>!changes.has(field)),inherited:{styleId:inherited.styleId,verification:inherited.verification,requested:inherited.requested.map(x=>({...x})),preserve:[...inherited.preserve]}};
}
function resolveCurrentRecipe(request:EditRequest,capabilities:PlanSemantic['capabilities']):{changes:ResolvedEdit[];presetVersion:string|null}{
  if(request.operation==='explore'){
    if(Object.keys(request.edits).length)throw new PlanError('EXPLORE_OVERRIDES_UNSUPPORTED',422);
    const expanded=expandPreset(request.styleId);
    const synthetic={schemaVersion:2,source:{kind:'original'},operation:'detail',edits:expanded.edits};
    return {changes:resolveEdits(synthetic,capabilities,{}).changes,presetVersion:expanded.version};
  }
  return {changes:resolveEdits(request,capabilities,{}).changes,presetVersion:null};
}
function activeConsent(db:DatabaseSync,catalog:ConsentCatalog,consentId:string,ownerId:string,providerId:string,generationPurpose:string){
  try{const current=createConsentService(db,catalog).assertSharing(consentId,ownerId);if(current.providerId!==providerId||!current.purposes.includes(generationPurpose))throw new ConsentError('CONSENT_INVALID');return current;}
  catch(error){if(error instanceof ConsentError)throw new PlanError(error.code,error.status);throw new PlanError('CONSENT_INVALID',403);}
}
function activeUploadConsent(db:DatabaseSync,catalog:ConsentCatalog,consentId:string,ownerId:string){
  try{return createConsentService(db,catalog).assertUpload(consentId,ownerId);}
  catch(error){if(error instanceof ConsentError)throw new PlanError(error.code,error.status);throw new PlanError('CONSENT_INVALID',403);}
}

interface SourceAudit {eventVersion:1;projectId:string;sourceKind:SourceKind;sourceSha256:string;storedOriginalSha256:string;normalizerVersion:string;consentId:string;licenseRegistryId?:string}
function sourceEvidenceFromAudit(db:DatabaseSync,scope:ProjectScope,originalDigest:string|null,normalizerVersion:string|null,config:NormalizedConfig):ProjectSourceEvidence{
  const rows=db.prepare("SELECT details_json FROM audit_events WHERE owner_id=? AND event_type='project.source.created'").all(scope.ownerId) as Array<{details_json:string}>;
  const matches:Array<{details:Record<string,unknown>}>=[];
  for(const row of rows){let value:unknown;try{value=JSON.parse(row.details_json);}catch{throw new PlanError('SOURCE_PROVENANCE_INVALID',409);}if(!isPlain(value)||!safeId(value.projectId))throw new PlanError('SOURCE_PROVENANCE_INVALID',409);if(value.projectId===scope.id)matches.push({details:value});}
  if(matches.length>1)throw new PlanError('SOURCE_PROVENANCE_INVALID',409);
  if(matches.length===0)return {kind:'unknown'};
  const {details}=matches[0],keys=['eventVersion','projectId','sourceKind','sourceSha256','storedOriginalSha256','normalizerVersion','consentId','licenseRegistryId'];
  if(Object.keys(details).some(k=>!keys.includes(k))||details.eventVersion!==1||details.projectId!==scope.id||!['user_upload','licensed_demo'].includes(String(details.sourceKind))||!digest(details.sourceSha256)||!digest(details.storedOriginalSha256)||!token(details.normalizerVersion)||!token(details.consentId))throw new PlanError('SOURCE_PROVENANCE_INVALID',409);
  if(!originalDigest||!normalizerVersion||details.storedOriginalSha256!==originalDigest||details.normalizerVersion!==normalizerVersion)throw new PlanError('SOURCE_PROVENANCE_INVALID',409);
  const kind=details.sourceKind as SourceKind;
  if(kind==='user_upload'){
    if(Object.hasOwn(details,'licenseRegistryId'))throw new PlanError('SOURCE_PROVENANCE_INVALID',409);
    return {kind,sourceSha256:details.sourceSha256 as string,storedOriginalSha256:details.storedOriginalSha256 as string,normalizerVersion:details.normalizerVersion as string,sourceConsentId:details.consentId as string};
  }
  if(!token(details.licenseRegistryId))throw new PlanError('SOURCE_PROVENANCE_INVALID',409);
  const approved=config.demoRegistry.find(x=>x.id===details.licenseRegistryId&&x.licensed);
  if(!approved||approved.sourceSha256!==details.sourceSha256)throw new PlanError('DEMO_UNAVAILABLE',403);
  return {kind,sourceSha256:details.sourceSha256 as string,storedOriginalSha256:details.storedOriginalSha256 as string,normalizerVersion:details.normalizerVersion as string,sourceConsentId:details.consentId as string,licenseRegistryId:details.licenseRegistryId as string};
}
function projectSourceEvidence(db:DatabaseSync,scope:ProjectScope,original:Awaited<ReturnType<typeof readGenerationBase>>|null,config:NormalizedConfig):ProjectSourceEvidence{
  return sourceEvidenceFromAudit(db,scope,original?.provenance.canonicalSha256??null,original?.provenance.normalizerVersion??null,config);
}

function imageReference(result:Awaited<ReturnType<typeof readGenerationBase>>):PlanImageReference{
  const {row,persistedRow,provenance}=result;
  if(!digest(persistedRow.digest)||!digest(provenance.rawSha256)||!digest(provenance.canonicalSha256)||!digest(provenance.pixelSha256)||persistedRow.digest!==provenance.rawSha256)throw new PlanError('SOURCE_INTEGRITY_INVALID',422);
  return {assetId:row.id,assetKind:row.kind as 'original'|'master',persistedSha256:persistedRow.digest,rawSha256:provenance.rawSha256,canonicalSha256:provenance.canonicalSha256,pixelSha256:provenance.pixelSha256,bytes:persistedRow.bytes,width:provenance.canonicalGeometry.width,height:provenance.canonicalGeometry.height,rawGeometry:{...provenance.rawGeometry},canonicalGeometry:{...provenance.canonicalGeometry},normalizerVersion:provenance.normalizerVersion,sourceFormat:provenance.sourceFormat,sourceOrientation:provenance.sourceOrientation};
}
function planSource(request:EditRequest,reference:PlanImageReference):PlanSemantic['source']{
  return {kind:request.source.kind,...(request.source.kind==='version'?{versionId:request.source.versionId}:{}),assetId:reference.assetId,assetKind:reference.assetKind,persistedSha256:reference.persistedSha256,rawSha256:reference.rawSha256,canonicalSha256:reference.canonicalSha256,pixelSha256:reference.pixelSha256,bytes:reference.bytes,width:reference.width,height:reference.height,rawGeometry:{...reference.rawGeometry},canonicalGeometry:{...reference.canonicalGeometry},normalizerVersion:reference.normalizerVersion,sourceFormat:reference.sourceFormat,sourceOrientation:reference.sourceOrientation};
}
function ensureSourceAllowed(config:NormalizedConfig,kind:AllowedSourceKind){if(!config.liveEnabled){if(config.demoEnabled)throw new PlanError('SOURCE_NOT_ALLOWED',403);throw unavailable();}if(!config.sourcePolicy.allowedKinds.includes(kind))throw new PlanError('SOURCE_NOT_ALLOWED',403);}
function safeError(error:unknown):never{
  if(error instanceof PlanError)throw error;
  if(error instanceof ConsentError)throw new PlanError(error.code,error.status);
  if(error instanceof AssetError)throw new PlanError(error.code==='ASSET_NOT_FOUND'?'SOURCE_NOT_FOUND':'SOURCE_INTEGRITY_INVALID',error.code==='ASSET_NOT_FOUND'?404:422);
  if(error instanceof ProfileError)throw unavailable();
  if(error instanceof ContractError)throw new PlanError(error.code,error.code==='NO_EFFECTIVE_CHANGE'?422:400);
  throw error;
}

function rowAsset(db:DatabaseSync,expected:AssetRow){
  const row=db.prepare(`SELECT id,owner_id,project_id,kind,mime,bytes,width,height,digest,storage_key,created_at,private_bytes
    FROM assets WHERE id=? AND owner_id=? AND project_id=?`).get(expected.id,expected.owner_id,expected.project_id) as (AssetRow&{private_bytes:Uint8Array|null})|undefined;
  if(!row||row.kind!==expected.kind||row.mime!==expected.mime||row.bytes!==expected.bytes||row.width!==expected.width||row.height!==expected.height||row.digest!==expected.digest||row.storage_key!==expected.storage_key||row.created_at!==expected.created_at)throw new PlanError('SOURCE_CHANGED',409);
  let bytes:Buffer|null=null;
  if(row.storage_key.startsWith('legacy://'))bytes=readAuthorizedLegacyBytes(db,row);
  else if(row.private_bytes)bytes=Buffer.from(row.private_bytes);
  if(!bytes||bytes.length!==row.bytes||hash(bytes)!==row.digest)throw new PlanError('SOURCE_CHANGED',409);
}
function transaction<T>(db:DatabaseSync,work:()=>T):T{db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
function validImageReference(value:unknown):value is PlanImageReference{
  if(!isPlain(value))return false;
  const keys=['assetId','assetKind','persistedSha256','rawSha256','canonicalSha256','pixelSha256','bytes','width','height','rawGeometry','canonicalGeometry','normalizerVersion','sourceFormat','sourceOrientation'];
  if(Reflect.ownKeys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))return false;
  return safeId(value.assetId)&&['original','master'].includes(String(value.assetKind))&&digest(value.persistedSha256)&&digest(value.rawSha256)&&digest(value.canonicalSha256)&&digest(value.pixelSha256)&&Number.isSafeInteger(value.bytes)&&Number(value.bytes)>0&&Number.isSafeInteger(value.width)&&Number(value.width)>0&&Number.isSafeInteger(value.height)&&Number(value.height)>0&&isPlain(value.rawGeometry)&&Number.isSafeInteger(value.rawGeometry.width)&&Number(value.rawGeometry.width)>0&&Number.isSafeInteger(value.rawGeometry.height)&&Number(value.rawGeometry.height)>0&&isPlain(value.canonicalGeometry)&&Number.isSafeInteger(value.canonicalGeometry.width)&&Number(value.canonicalGeometry.width)>0&&Number.isSafeInteger(value.canonicalGeometry.height)&&Number(value.canonicalGeometry.height)>0&&token(value.normalizerVersion)&&typeof value.sourceFormat==='string'&&value.sourceFormat.length>0&&(value.sourceOrientation===null||Number.isSafeInteger(value.sourceOrientation));
}
function validChange(value:unknown):value is ResolvedEdit{
  if(!isPlain(value)||!FIELDS.includes(value.field as Field))return false;
  if(value.action==='restore_original')return Reflect.ownKeys(value).length===2&&typeof value.field==='string';
  return value.action==='set'&&Reflect.ownKeys(value).length===3&&typeof value.value==='string'&&legacyChoices[value.field as Field].includes(value.value);
}
function validateSemantic(value:unknown):value is PlanSemantic{
  if(!isPlain(value))return false;
  const keys=['schemaVersion','ownerId','projectId','walletScope','executionMode','configurationDigest','generationPurpose','supplierExposureMicrosUSD','source','originalReference','projectSource','requestEdits','desiredRecipe','observedRecipe','presetVersion','capabilities','supplier','consent','policyVersion','sourcePolicyVersion','demoPolicyVersion','userCostUnits','outputCount'];
  if(!Reflect.ownKeys(value).every(k=>typeof k==='string'&&keys.includes(k))||keys.filter(k=>k!=='originalReference').some(k=>!Object.hasOwn(value,k)))return false;
  if(value.schemaVersion!==1||!safeId(value.ownerId)||!safeId(value.projectId)||value.userCostUnits!==1||value.outputCount!==1||!digest(value.configurationDigest)||!token(value.policyVersion)||!(value.sourcePolicyVersion===null||token(value.sourcePolicyVersion))||!(value.demoPolicyVersion===null||token(value.demoPolicyVersion))||!(value.presetVersion===null||token(value.presetVersion)))return false;
  const source=value.source;if(!isPlain(source)||!['original','version'].includes(String(source.kind)))return false;
  const {kind:sourceKind,versionId:sourceVersionId,...image}=source;
  if(!validImageReference(image)||image.assetKind!==(sourceKind==='original'?'original':'master'))return false;
  if(sourceKind==='version'&&!safeId(sourceVersionId)||sourceKind==='original'&&sourceVersionId!==undefined)return false;
  if(value.originalReference!==undefined&&!validImageReference(value.originalReference))return false;
  if(!isPlain(value.projectSource)||!['user_upload','licensed_demo','unknown'].includes(String(value.projectSource.kind)))return false;
  const audit=value.projectSource;
  if(audit.kind==='unknown'){if(Reflect.ownKeys(audit).length!==1)return false;}
  else {
    const auditKeys=audit.kind==='licensed_demo'?['kind','sourceSha256','storedOriginalSha256','normalizerVersion','sourceConsentId','licenseRegistryId']:['kind','sourceSha256','storedOriginalSha256','normalizerVersion','sourceConsentId'];
    try{exactKeys(audit,auditKeys);}catch{return false;}
    if(!digest(audit.sourceSha256)||!digest(audit.storedOriginalSha256)||!token(audit.normalizerVersion)||!token(audit.sourceConsentId)||audit.kind==='licensed_demo'&&!token(audit.licenseRegistryId))return false;
  }
  if(!isPlain(value.capabilities))return false;
  try{exactKeys(value.capabilities,['enabled','fields','originalReference']);}catch{return false;}
  if(value.capabilities.enabled!==true||!Array.isArray(value.capabilities.fields)||!value.capabilities.fields.length||value.capabilities.fields.some(f=>!FIELDS.includes(f as Field))||new Set(value.capabilities.fields).size!==value.capabilities.fields.length||typeof value.capabilities.originalReference!=='boolean')return false;
  if(!isPlain(value.consent))return false;
  try{exactKeys(value.consent,['recordId','policyId','policyVersion','providerId','purposes']);}catch{return false;}
  if(!token(value.consent.recordId)||!token(value.consent.policyId)||!token(value.consent.policyVersion)||!(value.consent.providerId===null||token(value.consent.providerId))||!Array.isArray(value.consent.purposes)||![2,3].includes(value.consent.purposes.length)||value.consent.purposes.some(p=>!token(p))||new Set(value.consent.purposes).size!==value.consent.purposes.length)return false;
  if(!isPlain(value.observedRecipe))return false;
  try{exactKeys(value.observedRecipe,['status','fields']);}catch{return false;}
  if(value.observedRecipe.status!=='unknown'||!isPlain(value.observedRecipe.fields)||Reflect.ownKeys(value.observedRecipe.fields).length!==0)return false;
  if(!validDesiredRecipe(value.desiredRecipe))return false;
  const desired=value.desiredRecipe,inherited=desired.inherited;
  const requestParsed:EditRequest|undefined=(()=>{try{const r=parseEditRequest(value.requestEdits);return canonicalJson(r)===canonicalJson(value.requestEdits)?r:undefined;}catch{return undefined;}})();
  if(!requestParsed||requestParsed.source.kind!==sourceKind||requestParsed.source.kind==='version'&&requestParsed.source.versionId!==sourceVersionId)return false;
  if(requestParsed.operation==='explore'?value.presetVersion!==PRESET_VERSION:value.presetVersion!==null)return false;
  let expectedRecipe:PlanSemantic['desiredRecipe'];
  const validatedCapabilities=value.capabilities as PlanSemantic['capabilities'];
  let current:ReturnType<typeof resolveCurrentRecipe>;
  try{current=resolveCurrentRecipe(requestParsed,validatedCapabilities);expectedRecipe=combineRecipe(inherited,current.changes,requestParsed);}catch{return false;}
  if(canonicalJson(expectedRecipe)!==canonicalJson(desired))return false;
  const currentRestore=sourceKind==='version'&&current.changes.some(x=>x.action==='restore_original');
  if(currentRestore!==(value.originalReference!==undefined))return false;
  if(value.executionMode==='licensed_demo'){
    return value.walletScope==='demo'&&value.projectSource.kind==='licensed_demo'&&value.supplier===null&&value.supplierExposureMicrosUSD===0&&value.generationPurpose===null&&value.sourcePolicyVersion===null&&token(value.demoPolicyVersion)&&value.policyVersion===value.demoPolicyVersion&&value.consent.providerId===null&&value.capabilities.fields.every(f=>f==='bodyColor'||f==='wheelColor');
  }
  if(value.executionMode!=='live'||value.walletScope!=='live'||value.projectSource.kind==='licensed_demo'||!token(value.generationPurpose)||value.sourcePolicyVersion===null||value.demoPolicyVersion!==null||value.consent.providerId===null||value.consent.purposes.length!==3||!value.consent.purposes.includes(value.generationPurpose)||!isPlain(value.supplier))return false;
  const supplier=value.supplier;
  try{exactKeys(supplier,['supplierProfileId','profileVersion','providerId','protocol','endpoint','model','templateVersion','output','maxSupplierCostMicrosUSD','approvedBudgetMicrosUSD','qualityEvidence','timeoutMs','maxInputBytes','maxOutputBytes','maxResponseBytes']);}catch{return false;}
  if(!token(supplier.supplierProfileId)||!token(supplier.profileVersion)||!token(supplier.providerId)||supplier.providerId!==value.consent.providerId||supplier.protocol!=='openai-images-edits'||supplier.endpoint!=='https://api.openai.com/v1/images/edits'||!token(supplier.model)||!token(supplier.templateVersion)||!token(supplier.qualityEvidence)||!isPlain(supplier.output))return false;
  try{exactKeys(supplier.output,['format','size','quality']);}catch{return false;}
  if(supplier.output.format!=='png'||!['1024x1024','1536x1024','1024x1536'].includes(String(supplier.output.size))||!['low','medium','high'].includes(String(supplier.output.quality))||!Number.isSafeInteger(supplier.maxSupplierCostMicrosUSD)||Number(supplier.maxSupplierCostMicrosUSD)<1||Number(supplier.maxSupplierCostMicrosUSD)>1_000_000_000||!Number.isSafeInteger(supplier.approvedBudgetMicrosUSD)||Number(supplier.approvedBudgetMicrosUSD)<Number(supplier.maxSupplierCostMicrosUSD)||Number(supplier.approvedBudgetMicrosUSD)>1_000_000_000||value.supplierExposureMicrosUSD!==supplier.maxSupplierCostMicrosUSD||!Number.isSafeInteger(supplier.timeoutMs)||Number(supplier.timeoutMs)<1||Number(supplier.timeoutMs)>300_000||!Number.isSafeInteger(supplier.maxInputBytes)||Number(supplier.maxInputBytes)<1||Number(supplier.maxInputBytes)>10*1024*1024||!Number.isSafeInteger(supplier.maxOutputBytes)||Number(supplier.maxOutputBytes)<1||Number(supplier.maxOutputBytes)>32*1024*1024||!Number.isSafeInteger(supplier.maxResponseBytes)||Number(supplier.maxResponseBytes)<1||Number(supplier.maxResponseBytes)>48*1024*1024)return false;
  return true;
}
export function validatePlanSnapshot(value:unknown):PlanSnapshot{
  const raw=parseJsonClone(value);if(!isPlain(raw))throw new PlanError('PLAN_ROW_INVALID',500);
  try{exactKeys(raw,['schemaVersion','planId','createdAt','expiresAt','semantic','planDigest']);}catch{throw new PlanError('PLAN_ROW_INVALID',500);}
  if(raw.schemaVersion!==1||!safeId(raw.planId)||typeof raw.createdAt!=='string'||!Number.isFinite(Date.parse(raw.createdAt))||typeof raw.expiresAt!=='string'||!Number.isFinite(Date.parse(raw.expiresAt))||Date.parse(raw.expiresAt)-Date.parse(raw.createdAt)!==10*60*1000||!validateSemantic(raw.semantic)||!digest(raw.planDigest))throw new PlanError('PLAN_ROW_INVALID',500);
  return deepFreeze(raw as unknown as PlanSnapshot);
}
/**
 * Build the request F05 should resolve for this dispatch. Explore snapshots persist an empty
 * raw edit map, so expand only their frozen, versioned preset here; detail snapshots keep only
 * the user's current edit map. Inherited recipe intent remains a display/history concern.
 */
export function providerEditRequest(value:unknown):EditRequest{
  const snapshot=validatePlanSnapshot(value);
  if(hash(canonicalJson(snapshot.semantic))!==snapshot.planDigest)throw new PlanError('PLAN_ROW_INVALID',500);
  const request=snapshot.semantic.requestEdits;
  if(request.operation==='detail')return parseEditRequest(request);
  if(snapshot.semantic.presetVersion!==PRESET_VERSION)throw new PlanError('PLAN_ROW_INVALID',500);
  let expanded:ReturnType<typeof expandPreset>;
  try{expanded=expandPreset(request.styleId);}catch{throw new PlanError('PLAN_ROW_INVALID',500);}
  if(expanded.version!==snapshot.semantic.presetVersion)throw new PlanError('PLAN_ROW_INVALID',500);
  return parseEditRequest({...request,edits:expanded.edits});
}
/** Validate and hash-check a persisted row before F09 uses the frozen quote. */
export async function validateStoredPlanRow(value:unknown):Promise<PlanSnapshot>{
  if(!isPlain(value))throw new PlanError('PLAN_ROW_INVALID',500);
  const required=['id','owner_id','project_id','source_asset_id','plan_digest','snapshot_json','user_cost_units','created_at','expires_at'];
  if(required.some(k=>!Object.hasOwn(value,k)))throw new PlanError('PLAN_ROW_INVALID',500);
  let snapshot:PlanSnapshot;try{snapshot=validatePlanSnapshot(JSON.parse(String(value.snapshot_json)));}catch{throw new PlanError('PLAN_ROW_INVALID',500);}
  if(value.id!==snapshot.planId||value.owner_id!==snapshot.semantic.ownerId||value.project_id!==snapshot.semantic.projectId||value.source_asset_id!==snapshot.semantic.source.assetId||value.plan_digest!==snapshot.planDigest||value.user_cost_units!==1||value.created_at!==snapshot.createdAt||value.expires_at!==snapshot.expiresAt)throw new PlanError('PLAN_ROW_INVALID',500);
  let actual:string;try{actual=await semanticDigest(snapshot.semantic);}catch{throw new PlanError('PLAN_ROW_INVALID',500);}
  if(actual!==snapshot.planDigest)throw new PlanError('PLAN_ROW_INVALID',500);return snapshot;
}
export function isPlanExpired(snapshot:PlanSnapshot,now=new Date()):boolean{return !Number.isFinite(now.getTime())||Date.parse(snapshot.expiresAt)<=now.getTime();}

export function createPlanService(options:PlanOptions){
  const {db}=options,catalog=freezeConsentCatalog(cloneConsentCatalog(options.consentCatalog)),reader=createSqlAssetReader(db);
  let staticConfig:NormalizedConfig|undefined,staticConfigError:unknown;
  if(!options.getConfig){try{staticConfig=normalizeConfig(options.config);}catch(error){staticConfigError=error;}}
  const readConfig=()=>{if(staticConfigError)throw unavailable();if(options.getConfig){try{return normalizeConfig(options.getConfig());}catch(error){if(error instanceof PlanError)throw error;throw unavailable();}}return staticConfig??normalizeConfig(undefined);};
  const clock=options.clock??(()=>new Date()),makeId=options.id??randomUUID;
  const consentSnapshot=(current:ReturnType<typeof activeUploadConsent>,executionMode:PlanSemantic['executionMode']):PlanSemantic['consent']=>({recordId:current.id,policyId:current.policyId,policyVersion:current.policyVersion,providerId:executionMode==='live'?current.providerId:null,purposes:[...current.purposes]});
  const supplierSnapshot=(candidate:PlanProfileCandidate,config:NormalizedConfig):NonNullable<PlanSemantic['supplier']>=>{
    const p=candidate.profile;if(p.maxCostMicrosUSD===null||p.qualityEvidence===null)throw unavailable();
    return {supplierProfileId:p.id,profileVersion:p.version,providerId:candidate.providerId,protocol:p.protocol,endpoint:p.endpoint,model:p.model,templateVersion:p.templateVersion,output:{...p.output},maxSupplierCostMicrosUSD:p.maxCostMicrosUSD,approvedBudgetMicrosUSD:config.budget,qualityEvidence:p.qualityEvidence,timeoutMs:p.timeoutMs,maxInputBytes:p.maxInputBytes,maxOutputBytes:p.maxOutputBytes,maxResponseBytes:p.maxResponseBytes};
  };
  const sourceRow=(scope:ProjectScope,assetId:string)=>db.prepare(`SELECT id,owner_id,project_id,kind,mime,bytes,width,height,digest,storage_key,created_at,private_bytes
    FROM assets WHERE id=? AND owner_id=? AND project_id=?`).get(assetId,scope.ownerId,scope.id) as (AssetRow&{private_bytes:Uint8Array|null})|undefined;
  function assertCurrentSemantics(snapshotInput:PlanSnapshot):void{
    const snapshot=validatePlanSnapshot(snapshotInput),semantic=snapshot.semantic,currentConfig=readConfig();
    if(currentConfig.fingerprint!==semantic.configurationDigest)throw new PlanError('PLAN_CONFIGURATION_CHANGED',409);
    const scope=activeProject(db,semantic.ownerId,semantic.projectId),assetId=selectedAssetId(db,scope,semantic.requestEdits.source);
    if(assetId!==semantic.source.assetId)throw new PlanError('SOURCE_CHANGED',409);
    if(canonicalJson(inheritedIntent(selectedRecipeJson(db,scope,semantic.requestEdits.source)))!==canonicalJson(semantic.desiredRecipe.inherited))throw new PlanError('SOURCE_CHANGED',409);
    const selected=sourceRow(scope,assetId);if(!selected)throw invalidSource();rowAsset(db,selected);
    if(selected.kind!==semantic.source.assetKind||selected.digest!==semantic.source.persistedSha256||selected.bytes!==semantic.source.bytes)throw new PlanError('SOURCE_CHANGED',409);
    let originalRow:(AssetRow&{private_bytes:Uint8Array|null})|undefined;
    if(scope.originalAssetId){originalRow=sourceRow(scope,scope.originalAssetId);if(!originalRow||originalRow.kind!=='original')throw new PlanError('SOURCE_CHANGED',409);rowAsset(db,originalRow);}
    if(semantic.originalReference){if(!originalRow||semantic.originalReference.assetId!==originalRow.id||semantic.originalReference.persistedSha256!==originalRow.digest||semantic.originalReference.bytes!==originalRow.bytes)throw new PlanError('SOURCE_CHANGED',409);}
    const evidence=sourceEvidenceFromAudit(db,scope,originalRow?.digest??null,semantic.projectSource.kind==='unknown'?null:semantic.projectSource.normalizerVersion??null,currentConfig);
    if(canonicalJson(evidence)!==canonicalJson(semantic.projectSource))throw new PlanError('SOURCE_CHANGED',409);
    if(semantic.executionMode==='licensed_demo'){
      if(!currentConfig.demoEnabled||evidence.kind!=='licensed_demo'||semantic.policyVersion!==currentConfig.demoPolicyVersion||semantic.demoPolicyVersion!==currentConfig.demoPolicyVersion||semantic.sourcePolicyVersion!==null)throw new PlanError('PLAN_CONFIGURATION_CHANGED',409);
      const currentConsent=activeUploadConsent(db,catalog,semantic.consent.recordId,semantic.ownerId);
      if(canonicalJson(consentSnapshot(currentConsent,'licensed_demo'))!==canonicalJson(semantic.consent))throw new PlanError('CONSENT_INVALID',403);
      const capabilities={enabled:true as const,fields:[...currentConfig.demoFields],originalReference:currentConfig.demoOriginalReference};
      if(canonicalJson(capabilities)!==canonicalJson(semantic.capabilities)||semantic.supplier!==null||semantic.supplierExposureMicrosUSD!==0||semantic.generationPurpose!==null)throw new PlanError('PLAN_CONFIGURATION_CHANGED',409);
    }else{
      if(evidence.kind==='licensed_demo')throw new PlanError('SOURCE_CHANGED',409);
      ensureSourceAllowed(currentConfig,evidence.kind);
      const candidate=selectedCandidate(currentConfig),supplier=supplierSnapshot(candidate,currentConfig),currentConsent=activeConsent(db,catalog,semantic.consent.recordId,semantic.ownerId,candidate.providerId,currentConfig.requiredGenerationPurpose);
      const capabilities=profileCapabilities(candidate.profile);
      if(canonicalJson(supplier)!==canonicalJson(semantic.supplier)||canonicalJson(capabilities)!==canonicalJson(semantic.capabilities)||canonicalJson(consentSnapshot(currentConsent,'live'))!==canonicalJson(semantic.consent)||semantic.policyVersion!==currentConfig.policyVersion||semantic.sourcePolicyVersion!==currentConfig.sourcePolicy.version||semantic.demoPolicyVersion!==null||semantic.generationPurpose!==currentConfig.requiredGenerationPurpose||semantic.supplierExposureMicrosUSD!==supplier.maxSupplierCostMicrosUSD)throw new PlanError('PLAN_CONFIGURATION_CHANGED',409);
    }
  }
  /** Bind an immutable, persisted quote and recheck it within the caller's synchronous transaction.
   * F09 checks expiry for a new confirmation; accepted F10 work may outlive the quote's expiry. */
  function assertCurrent(snapshotInput:PlanSnapshot):void{
    const snapshot=validatePlanSnapshot(snapshotInput),semantic=snapshot.semantic;
    const stored=db.prepare('SELECT owner_id,project_id,source_asset_id,plan_digest,snapshot_json,user_cost_units,created_at,expires_at FROM plans WHERE id=?').get(snapshot.planId) as {owner_id:string;project_id:string;source_asset_id:string;plan_digest:string;snapshot_json:string;user_cost_units:number;created_at:string;expires_at:string}|undefined;
    if(!stored||stored.owner_id!==semantic.ownerId||stored.project_id!==semantic.projectId||stored.source_asset_id!==semantic.source.assetId||stored.plan_digest!==snapshot.planDigest||stored.snapshot_json!==canonicalJson(snapshot)||stored.user_cost_units!==1||stored.created_at!==snapshot.createdAt||stored.expires_at!==snapshot.expiresAt||hash(canonicalJson(semantic))!==snapshot.planDigest)throw new PlanError('PLAN_ROW_INVALID',500);
    assertCurrentSemantics(snapshot);
  }
  /** Re-read exact F06 inputs, verify the frozen hashes, then recheck after every await. */
  async function readCurrentInputs(snapshotInput:PlanSnapshot){
    const snapshot=validatePlanSnapshot(snapshotInput),semantic=snapshot.semantic;
    assertCurrent(snapshot);
    const scope=activeProject(db,semantic.ownerId,semantic.projectId),sourceId=selectedAssetId(db,scope,semantic.requestEdits.source);
    const row=await reader.findOwned(sourceId,semantic.ownerId,semantic.projectId);
    if(!row||row.kind!==semantic.source.assetKind)throw invalidSource();
    const source=await readGenerationBase(reader,sourceId,semantic.ownerId,semantic.projectId);
    const original=scope.originalAssetId===sourceId?source:scope.originalAssetId?await readGenerationBase(reader,scope.originalAssetId,semantic.ownerId,semantic.projectId):null;
    if(canonicalJson(planSource(semantic.requestEdits,imageReference(source)))!==canonicalJson(semantic.source))throw new PlanError('SOURCE_CHANGED',409);
    if(semantic.originalReference&&(!original||canonicalJson(imageReference(original))!==canonicalJson(semantic.originalReference)))throw new PlanError('SOURCE_CHANGED',409);
    checkProviderInputSizes(semantic.supplier,source.bytes,semantic.originalReference?original?.bytes??null:null);
    if(canonicalJson(projectSourceEvidence(db,scope,original,readConfig()))!==canonicalJson(semantic.projectSource))throw new PlanError('SOURCE_CHANGED',409);
    assertCurrent(snapshot);return Object.freeze({source,originalReference:semantic.originalReference?original:null});
  }
  async function quote(ownerId:string,projectId:string,consentId:string,rawRequest:unknown):Promise<PlanSnapshot>{
    try{
      const parsed=parseEditRequest(rawRequest),initialConfig=readConfig(),initialScope=activeProject(db,ownerId,projectId),sourceAssetId=selectedAssetId(db,initialScope,parsed.source),inherited=inheritedIntent(selectedRecipeJson(db,initialScope,parsed.source));
      const exact=await reader.findOwned(sourceAssetId,ownerId,projectId);
      if(!exact||exact.kind!==(parsed.source.kind==='original'?'original':'master'))throw invalidSource();
      const read=await readGenerationBase(reader,sourceAssetId,ownerId,projectId);
      const sourceImage=imageReference(read);
      let originalRead:Awaited<ReturnType<typeof readGenerationBase>>|null=null;
      if(initialScope.originalAssetId){
        if(initialScope.originalAssetId===sourceAssetId){if(read.persistedRow.kind!=='original')throw new PlanError('SOURCE_CHANGED',409);originalRead=read;}
        else {const originalRow=await reader.findOwned(initialScope.originalAssetId,ownerId,projectId);if(!originalRow||originalRow.kind!=='original')throw invalidSource();originalRead=await readGenerationBase(reader,initialScope.originalAssetId,ownerId,projectId);}
      }
      const sourceEvidence=projectSourceEvidence(db,initialScope,originalRead,initialConfig);
      let executionMode:PlanSemantic['executionMode'],capabilities:PlanSemantic['capabilities'],currentConsent:ReturnType<typeof activeUploadConsent>,supplier:PlanSemantic['supplier'];
      if(sourceEvidence.kind==='licensed_demo'){
        if(!initialConfig.demoEnabled)throw new PlanError('DEMO_UNAVAILABLE',403);
        executionMode='licensed_demo';capabilities={enabled:true,fields:[...initialConfig.demoFields],originalReference:initialConfig.demoOriginalReference};currentConsent=activeUploadConsent(db,catalog,consentId,ownerId);supplier=null;
      }else{
        ensureSourceAllowed(initialConfig,sourceEvidence.kind);const candidate=selectedCandidate(initialConfig);executionMode='live';const profileCaps=profileCapabilities(candidate.profile);capabilities={enabled:true,fields:[...profileCaps.fields],originalReference:profileCaps.originalReference};currentConsent=activeConsent(db,catalog,consentId,ownerId,candidate.providerId,initialConfig.requiredGenerationPurpose);supplier=supplierSnapshot(candidate,initialConfig);
      }
      const current=resolveCurrentRecipe(parsed,capabilities),recipe=combineRecipe(inherited,current.changes,parsed),restore=parsed.source.kind==='version'&&current.changes.some(edit=>edit.action==='restore_original');
      if(restore&&initialScope.originalAssetId===null)throw new PlanError('ORIGINAL_REFERENCE_UNSUPPORTED',422);
      if(restore&&!capabilities.originalReference)throw new PlanError('ORIGINAL_REFERENCE_UNSUPPORTED',422);
      if(restore&&(!originalRead||originalRead.persistedRow.kind!=='original'))throw invalidSource();
      checkProviderInputSizes(supplier,read.bytes,restore?originalRead?.bytes??null:null);
      const frozenConsent=consentSnapshot(currentConsent,executionMode),generationPurpose=executionMode==='live'?initialConfig.requiredGenerationPurpose:null;
      const semantic:PlanSemantic=deepFreeze({schemaVersion:1,ownerId,projectId,walletScope:executionMode==='live'?'live':'demo',executionMode,configurationDigest:initialConfig.fingerprint,generationPurpose,supplierExposureMicrosUSD:supplier?.maxSupplierCostMicrosUSD??0,source:planSource(parsed,sourceImage),...(restore&&originalRead?{originalReference:imageReference(originalRead)}:{}),projectSource:sourceEvidence,requestEdits:parsed,desiredRecipe:recipe,observedRecipe:{status:'unknown',fields:{}},presetVersion:current.presetVersion,capabilities,supplier,consent:frozenConsent,policyVersion:executionMode==='live'?initialConfig.policyVersion:initialConfig.demoPolicyVersion,sourcePolicyVersion:executionMode==='live'?initialConfig.sourcePolicy.version:null,demoPolicyVersion:executionMode==='licensed_demo'?initialConfig.demoPolicyVersion:null,userCostUnits:1,outputCount:1});
      const planDigest=await semanticDigest(semantic),currentConfig=readConfig();
      if(currentConfig.fingerprint!==initialConfig.fingerprint)throw new PlanError('PLAN_CONFIGURATION_CHANGED',409);
      const createdDate=clock();if(!(createdDate instanceof Date)||!Number.isFinite(createdDate.getTime()))throw unavailable();
      const createdAt=createdDate.toISOString(),expiresAt=new Date(createdDate.getTime()+10*60*1000).toISOString(),planId=makeId();
      if(!safeId(planId))throw unavailable();
      const snapshot=validatePlanSnapshot({schemaVersion:1,planId,createdAt,expiresAt,semantic,planDigest});
      transaction(db,()=>{
        assertCurrentSemantics(snapshot);
        const json=canonicalJson(snapshot);
        db.prepare(`INSERT INTO plans(id,owner_id,project_id,source_asset_id,plan_digest,snapshot_json,user_cost_units,confirmed_at,expires_at,created_at)
          VALUES (?,?,?,?,?,?,?,NULL,?,?)`).run(planId,ownerId,projectId,sourceAssetId,planDigest,json,1,expiresAt,createdAt);
      });
      return snapshot;
    }catch(error){safeError(error);}
  }
  return Object.freeze({quote,assertCurrent,readCurrentInputs});
}
