/** F06 read boundary. The production repository/storage transaction belongs to F07/F10. */
import { createHash } from 'node:crypto';
import { IMAGE_LIMITS, normalizeInput, validateOutputMaster, type ImageAsset } from './images.js';

/** Existing F02 assets columns; no new table, schema alteration or parallel persistence system. */
export interface AssetRow {
  id:string; owner_id:string; project_id:string; kind:'original'|'master'|'display'|'temporary';
  mime:string; bytes:number; width:number|null; height:number|null;
  digest:string|null; storage_key:string; created_at:string;
}
export type StorageLocator =
  | {kind:'private';assetId:string;ownerId:string;projectId:string;storageKey:string}
  | {kind:'legacy';assetId:string;ownerId:string;sourceOwnerId?:string;projectId:string;storageKey:string;legacyImageId:string};
export interface AssetReader {
  canReadProject(ownerId:string,projectId:string): Promise<boolean>;
  findOwned(id:string,ownerId:string,projectId:string): Promise<AssetRow|null>;
  canReadLegacyOrigin?(locator:Extract<StorageLocator,{kind:'legacy'}>): Promise<boolean>;
  readBytes(locator:StorageLocator): Promise<Buffer>;
}
export class AssetError extends Error {constructor(readonly code:string){super(code);this.name='AssetError';}}
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const digest=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
const missing=()=>{throw new AssetError('ASSET_NOT_FOUND');};
const invalid=()=>{throw new AssetError('ASSET_INTEGRITY_INVALID');};
function authorize(row:AssetRow|null,assetId:string,ownerId:string,projectId:string): asserts row is AssetRow {
  if(!row||row.id!==assetId||row.owner_id!==ownerId||row.project_id!==projectId)missing();
}
function locatorFor(row:AssetRow): StorageLocator {
  const legacy=/^legacy:\/\/(legacy-owner-[a-f0-9]{24})\/([A-Za-z0-9_-]{1,128})$/.exec(row.storage_key);
  if(legacy){
    return {kind:'legacy',assetId:row.id,ownerId:row.owner_id,...(legacy[1]===row.owner_id?{}:{sourceOwnerId:legacy[1]}),projectId:row.project_id,storageKey:row.storage_key,legacyImageId:legacy[2]};
  }
  if(!id(row.storage_key))invalid();
  return {kind:'private',assetId:row.id,ownerId:row.owner_id,projectId:row.project_id,storageKey:row.storage_key};
}
function validateRow(row:AssetRow,locator:StorageLocator) {
  if(!['original','master','display','temporary'].includes(row.kind)||!Number.isSafeInteger(row.bytes)||row.bytes<=0||!row.digest||!/^[a-f0-9]{64}$/.test(row.digest))invalid();
  if(locator.kind==='legacy'){
    const limit=row.kind==='original'?IMAGE_LIMITS.inputBytes:IMAGE_LIMITS.outputBytes;
    if((row.kind!=='original'&&row.kind!=='master')||row.mime!=='application/octet-stream'||row.width!==null||row.height!==null||row.bytes>limit)invalid();
    return;
  }
  if(!id(row.storage_key)||row.mime!=='image/png'||!Number.isSafeInteger(row.width)||!Number.isSafeInteger(row.height)||!row.width||!row.height||row.width<1||row.height<1||row.width*row.height>IMAGE_LIMITS.pixels||row.bytes>IMAGE_LIMITS.outputBytes)invalid();
}
async function readerCall<T>(operation:()=>Promise<T>):Promise<T> {
  try{return await operation();}catch{throw new AssetError('ASSET_READ_FAILED');}
}
function unchanged(before:AssetRow,after:AssetRow) {
  return before.id===after.id&&before.owner_id===after.owner_id&&before.project_id===after.project_id&&before.kind===after.kind&&before.mime===after.mime&&before.bytes===after.bytes&&before.width===after.width&&before.height===after.height&&before.digest===after.digest&&before.storage_key===after.storage_key&&before.created_at===after.created_at;
}
async function currentRow(reader:AssetReader,assetId:string,ownerId:string,projectId:string,expected?:AssetRow):Promise<AssetRow> {
  if(!await readerCall(()=>reader.canReadProject(ownerId,projectId)))missing();
  const found=await readerCall(()=>reader.findOwned(assetId,ownerId,projectId));
  authorize(found,assetId,ownerId,projectId);
  if(expected&&!unchanged(expected,found))throw new AssetError('ASSET_CHANGED_DURING_READ');
  const locator=locatorFor(found);
  if(locator.kind==='legacy'&&locator.sourceOwnerId!==undefined&&(!reader.canReadLegacyOrigin||!await readerCall(()=>reader.canReadLegacyOrigin!(locator))))invalid();
  return {...found};
}
export function assetInsertMetadata(input:{id:string;ownerId:string;projectId:string;kind:AssetRow['kind'];storageKey:string;createdAt:string},image:ImageAsset): AssetRow {
  if(!id(input.id)||!id(input.ownerId)||!id(input.projectId)||!id(input.storageKey)||!['original','master','display','temporary'].includes(input.kind)||!Number.isFinite(Date.parse(input.createdAt)))throw new AssetError('INVALID_ASSET_METADATA');
  if(digest(image.bytes)!==image.sha256)throw new AssetError('ASSET_DIGEST_MISMATCH');
  const row:AssetRow={id:input.id,owner_id:input.ownerId,project_id:input.projectId,kind:input.kind,storage_key:input.storageKey,created_at:input.createdAt,mime:image.mime,bytes:image.bytes.length,width:image.width,height:image.height,digest:image.sha256};
  const locator=locatorFor(row);validateRow(row,locator);return Object.freeze(row);
}
function png(bytes:Buffer) {
  return bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
}
function provenance(raw:Buffer,image:ImageAsset) {
  return {rawSha256:digest(raw),canonicalSha256:image.sha256,rawGeometry:{width:image.sourceWidth,height:image.sourceHeight},canonicalGeometry:{width:image.width,height:image.height},normalizerVersion:image.normalizerVersion,pixelSha256:image.pixelSha256,sourceFormat:image.sourceFormat,sourceOrientation:image.sourceOrientation};
}
async function readAsset(reader:AssetReader,assetId:string,ownerId:string,projectId:string,generationBaseOnly:boolean) {
  if(!id(assetId)||!id(ownerId)||!id(projectId))missing();
  const persistedRow=await currentRow(reader,assetId,ownerId,projectId);
  const locator=locatorFor(persistedRow);validateRow(persistedRow,locator);
  if(generationBaseOnly&&persistedRow.kind!=='original'&&persistedRow.kind!=='master')throw new AssetError('DISPLAY_IS_NOT_GENERATION_INPUT');
  const raw=await readerCall(()=>reader.readBytes(locator));
  await currentRow(reader,assetId,ownerId,projectId,persistedRow);
  if(!Buffer.isBuffer(raw)||raw.length!==persistedRow.bytes||digest(raw)!==persistedRow.digest)throw new AssetError('ASSET_DIGEST_MISMATCH');
  let image:ImageAsset;
  if(locator.kind==='legacy'){
    try{image=persistedRow.kind==='original'?await normalizeInput(raw):await validateOutputMaster(raw);}
    catch{throw new AssetError('ASSET_INTEGRITY_INVALID');}
  }else{
    if(!png(raw))invalid();
    try{image=await validateOutputMaster(raw);}
    catch{throw new AssetError('ASSET_INTEGRITY_INVALID');}
    if(image.width!==persistedRow.width||image.height!==persistedRow.height)invalid();
  }
  // Decode/normalization is asynchronous too: repeat owner, project/tombstone, and row checks before returning.
  await currentRow(reader,assetId,ownerId,projectId,persistedRow);
  const compatibleRow:AssetRow=locator.kind==='legacy'?{...persistedRow,mime:'image/png',bytes:image.bytes.length,width:image.width,height:image.height,digest:image.sha256}:persistedRow;
  return {row:compatibleRow,persistedRow,compatibleRow,image,provenance:provenance(raw,image),bytes:locator.kind==='legacy'?image.bytes:raw,headers:{'Cache-Control':'private, no-store','Content-Type':compatibleRow.mime,'X-Content-Type-Options':'nosniff'}};
}
export async function readOwnedAsset(reader:AssetReader,assetId:string,ownerId:string,projectId:string) {
  return readAsset(reader,assetId,ownerId,projectId,false);
}
export async function readGenerationBase(reader:AssetReader,assetId:string,ownerId:string,projectId:string) {
  return readAsset(reader,assetId,ownerId,projectId,true);
}
