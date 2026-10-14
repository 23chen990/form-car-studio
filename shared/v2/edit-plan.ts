/** Server-side pure contract. It does not check ownership or authorize a provider call. */
export const COLORS = ['white','black','silver','graphite','blue','green','red','yellow'] as const;
export const WHEEL_COLORS = ['silver','graphite','bronze','black','white'] as const;
export const FINISHES = ['gloss','satin','matte'] as const;
export const WHEEL_DESIGNS = ['sport_multi_spoke','classic_mesh'] as const;
export const STYLES = ['clean','sport','dark','heritage','track','rally','touring','color'] as const;
export const FIELDS = ['bodyColor','wheelColor','bodyFinish','wheelDesign'] as const;
export type Field = typeof FIELDS[number];
export type Edit = {action:'preserve'} | {action:'restore_original'} | {action:'set';value:string};
export type SourceRef = {kind:'original'} | {kind:'version';versionId:string};
export interface EditRequest {schemaVersion:2;source:SourceRef;operation:'explore'|'detail';styleId?:typeof STYLES[number];edits:Partial<Record<Field,Edit>>}
export interface Capabilities {enabled:boolean;fields:readonly Field[];originalReference:boolean}
export interface Observation {value:string;provenance:'verified'|'requested'}
export type Observations = Partial<Record<Field,Observation>>;
export class ContractError extends Error { constructor(public readonly code:string){super(code);this.name='ContractError';} }
export function demand(ok:unknown,code:string):asserts ok {if(!ok)throw new ContractError(code);}
export function record(v:unknown):v is Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));}
export function exact(v:Record<string,unknown>,keys:readonly string[]):void{demand(Reflect.ownKeys(v).every(k=>typeof k==='string'&&keys.includes(k)),'UNKNOWN_FIELD');}
const choices:Record<Field,readonly string[]>={bodyColor:COLORS,wheelColor:WHEEL_COLORS,bodyFinish:FINISHES,wheelDesign:WHEEL_DESIGNS};
const id=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
export function parseEditRequest(value:unknown):EditRequest{
 demand(record(value),'REQUEST_OBJECT_REQUIRED');exact(value,['schemaVersion','source','operation','styleId','edits']);
 demand(value.schemaVersion===2,'UNSUPPORTED_SCHEMA');demand(record(value.source),'SOURCE_REQUIRED');
 const source=value.source;demand(source.kind==='original'||source.kind==='version','INVALID_SOURCE');
 exact(source,source.kind==='original'?['kind']:['kind','versionId']);if(source.kind==='version')demand(id(source.versionId),'INVALID_VERSION_ID');
 demand(value.operation==='explore'||value.operation==='detail','INVALID_OPERATION');
 if(value.operation==='explore'){demand(source.kind==='original','EXPLORE_REQUIRES_ORIGINAL');demand(STYLES.includes(value.styleId as typeof STYLES[number]),'INVALID_STYLE');}
 else demand(value.styleId===undefined,'DETAIL_MUST_NOT_APPLY_STYLE');
 demand(record(value.edits),'EDITS_REQUIRED');exact(value.edits,FIELDS);
 const edits:Partial<Record<Field,Edit>>={};
 for(const field of FIELDS){const item=value.edits[field];if(item===undefined)continue;
  demand(record(item),'INVALID_EDIT');demand(typeof item.action==='string'&&['preserve','restore_original','set'].includes(item.action),'INVALID_ACTION');
  exact(item,item.action==='set'?['action','value']:['action']);
  if(item.action==='set'){demand(typeof item.value==='string'&&choices[field].includes(item.value),'UNSUPPORTED_VALUE');edits[field]={action:'set',value:item.value};}
  else edits[field]={action:item.action as 'preserve'|'restore_original'};
 }
 return {schemaVersion:2,source:source.kind==='original'?{kind:'original'}:{kind:'version',versionId:source.versionId as string},operation:value.operation,...(value.operation==='explore'?{styleId:value.styleId as typeof STYLES[number]}:{}),edits};
}
export interface ResolvedEdit {field:Field;action:'set'|'restore_original';value?:string}
/** Call only after expanding the chosen, versioned server preset into explicit edits. */
export function resolveEdits(raw:unknown,cap:Capabilities,base:Observations={}):{request:EditRequest;changes:ResolvedEdit[];preserve:Field[]}{
 const request=parseEditRequest(raw);demand(record(cap),'INVALID_CAPABILITY');exact(cap,['enabled','fields','originalReference']);demand(cap.enabled===true,'CAPABILITY_DISABLED');
 demand(Array.isArray(cap.fields)&&cap.fields.every(f=>FIELDS.includes(f))&&typeof cap.originalReference==='boolean','INVALID_CAPABILITY');
 demand(record(base),'INVALID_OBSERVATIONS');exact(base,FIELDS);
 for(const field of FIELDS){const o=base[field];if(o===undefined)continue;demand(record(o),'INVALID_OBSERVATION');exact(o,['value','provenance']);demand(typeof o.value==='string'&&choices[field].includes(o.value)&&['verified','requested'].includes(o.provenance),'INVALID_OBSERVATION');}
 const changes:ResolvedEdit[]=[];
 for(const field of FIELDS){const edit=request.edits[field];if(!edit||edit.action==='preserve')continue;
  demand(cap.fields.includes(field),'FIELD_NOT_ENABLED');
  if(edit.action==='restore_original'){if(request.source.kind==='original')continue;demand(cap.originalReference,'ORIGINAL_REFERENCE_UNSUPPORTED');changes.push({field,action:'restore_original'});}
  else {const observation=base[field];if(observation?.provenance==='verified'&&observation.value===edit.value)continue;changes.push({field,action:'set',value:edit.value});}
 }
 demand(changes.length>0,'NO_EFFECTIVE_CHANGE');
 return {request,changes,preserve:FIELDS.filter(f=>!changes.some(c=>c.field===f))};
}
/** Data-only canonical JSON. Unknown/unsupported JS values fail rather than disappear. */
export function canonicalJson(value:unknown):string{
 const active=new Set<object>();
 const visit=(v:unknown):unknown=>{
  if(v===null||typeof v==='string'||typeof v==='boolean')return v;
  if(typeof v==='number'){demand(Number.isFinite(v),'NON_FINITE_NUMBER');return v;}
  demand(Array.isArray(v)||record(v),'NON_JSON_VALUE');demand(!active.has(v as object),'CYCLIC_VALUE');active.add(v as object);
  let out:unknown;
  if(Array.isArray(v)){demand(Reflect.ownKeys(v).length===v.length+1&&v.every((_item,i)=>Object.hasOwn(v,i))&&Array.from({length:v.length},(_item,i)=>Object.hasOwn(v,i)).every(Boolean),'SPARSE_OR_EXTRA_ARRAY');out=v.map(visit);}
  else {demand(Reflect.ownKeys(v).every(k=>typeof k==='string'),'SYMBOL_KEY');const next:Record<string,unknown>=Object.create(null);for(const k of Object.keys(v).sort())next[k]=visit(v[k]);out=next;}
  active.delete(v as object);return out;
 };return JSON.stringify(visit(value));
}
/** Hash all frozen semantics with owner identity; HTTP replay lookup remains owner-scoped. */
export async function semanticDigest(value:unknown):Promise<string>{const bytes=new TextEncoder().encode(canonicalJson(value));const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');}
