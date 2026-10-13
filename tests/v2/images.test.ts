import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {normalizeInput,validateOutputMaster,createDisplayAsset,exactPixelEquality,ImageError,IMAGE_LIMITS} from '../../server/v2/images.js';
import {assetInsertMetadata,readOwnedAsset,readGenerationBase,AssetError,type AssetRow,type AssetReader,type StorageLocator} from '../../server/v2/assets.js';
import {migrateLegacyDatabase} from '../../server/v2/migrate.js';
const sample=(width=8,height=4,color='#cc3344')=>sharp({create:{width,height,channels:4,background:color}}).png().toBuffer();
const metadata=(kind:AssetRow['kind']='master')=>({id:'asset-1',ownerId:'owner-1',projectId:'project-1',kind,storageKey:'storage-1',createdAt:'2026-10-13T00:00:00Z'});
async function fixture(kind:AssetRow['kind']='master') {
  const image=await validateOutputMaster(await sample());const row=assetInsertMetadata(metadata(kind),image);
  let reads=0;let allowed=true;let current:AssetRow|null=row;let lastLocator:StorageLocator|null=null;
  const reader:AssetReader={canReadProject:async()=>allowed,findOwned:async()=>current,readBytes:async(locator)=>{reads++;lastLocator=locator;return image.bytes;}};
  return {image,row,reader,get reads(){return reads;},get lastLocator(){return lastLocator;},block:()=>{allowed=false;},setRow:(r:AssetRow|null)=>{current=r;}};
}
function crc32(b:Buffer){let c=0xffffffff;for(const x of b){c^=x;for(let k=0;k<8;k++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return (c^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length,0);result.write(type,4,'ascii');data.copy(result,8);result.writeUInt32BE(crc32(result.subarray(4,8+data.length)),8+data.length);return result;}
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const legacyOwnerId=(cookie:string)=>`legacy-owner-${sha(Buffer.from(`form:v2:legacy-owner\0${cookie}`)).slice(0,24)}`;
const safeLegacyId=(prefix:string,owner:string,value:string)=>`${prefix}-${sha(Buffer.from(`${owner}:${value}`)).slice(0,24)}`;

async function migratedLegacyFixture() {
  const directory=mkdtempSync(join(tmpdir(),'form-f06-legacy-'));
  const sourcePath=join(directory,'legacy.sqlite'),backupPath=join(directory,'backup.sqlite'),outputPath=join(directory,'v3.sqlite');
  const rawImage=await sample(7,3,'#397acb');
  const cookie='synthetic-cookie-a',legacyProjectId='legacy-project-a',legacyImageId='legacy-image-a';
  const legacy=new DatabaseSync(sourcePath);
  legacy.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY,state TEXT NOT NULL); CREATE TABLE images (id TEXT PRIMARY KEY,owner TEXT NOT NULL,project_id TEXT NOT NULL,data BLOB NOT NULL); CREATE TABLE reports (id TEXT PRIMARY KEY,owner TEXT NOT NULL,task_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);');
  legacy.prepare('INSERT INTO sessions VALUES (?,?)').run(cookie,JSON.stringify({credits:0,reservedCredits:0,projects:[{id:legacyProjectId,originalUrl:`/api/images/${legacyImageId}`,versions:[]}]}));
  legacy.prepare('INSERT INTO images VALUES (?,?,?,?)').run(legacyImageId,cookie,legacyProjectId,rawImage);
  legacy.close();
  migrateLegacyDatabase({inputPath:sourcePath,backupPath,outputPath,apply:true});
  const db=new DatabaseSync(outputPath);db.exec('PRAGMA foreign_keys=ON');
  const ownerId=legacyOwnerId(cookie),projectId=safeLegacyId('legacy-project',ownerId,legacyProjectId);
  let reads=0;
  const reader:AssetReader={
    canReadProject:async(owner,project)=>!!db.prepare('SELECT 1 FROM projects WHERE owner_id=? AND id=? AND deleted_at IS NULL').get(owner,project),
    findOwned:async(id,owner,project)=>{
      const row=db.prepare('SELECT id,owner_id,project_id,kind,mime,bytes,width,height,digest,storage_key,created_at FROM assets WHERE id=? AND owner_id=? AND project_id=?').get(id,owner,project) as AssetRow|undefined;
      return row??null;
    },
    readBytes:async(locator)=>{
      reads++;
      if(locator.kind==='legacy'){
        const row=db.prepare('SELECT id,owner,project_id,data FROM images WHERE id=?').get(locator.legacyImageId) as {id:string;owner:string;project_id:string;data:Uint8Array}|undefined;
        const identity=row&&db.prepare("SELECT user_id FROM identities WHERE provider='legacy_cookie' AND subject=?").get(sha(Buffer.from(row.owner))) as {user_id:string}|undefined;
        if(!row||!identity||identity.user_id!==locator.ownerId||legacyOwnerId(row.owner)!==locator.ownerId||safeLegacyId('legacy-project',locator.ownerId,row.project_id)!==locator.projectId||row.id!==locator.legacyImageId)throw new Error('legacy image lookup denied');
        return Buffer.from(row.data);
      }
      const row=db.prepare('SELECT private_bytes FROM assets WHERE id=? AND owner_id=? AND project_id=? AND storage_key=?').get(locator.assetId,locator.ownerId,locator.projectId,locator.storageKey) as {private_bytes:Uint8Array|null}|undefined;
      if(!row?.private_bytes)throw new Error('private asset lookup denied');
      return Buffer.from(row.private_bytes);
    }
  };
  const asset=db.prepare("SELECT id FROM assets WHERE owner_id=? AND project_id=? AND kind='original'").get(ownerId,projectId) as {id:string}|undefined;
  const master=db.prepare("SELECT id FROM assets WHERE owner_id=? AND project_id=? AND kind='master'").get(ownerId,projectId) as {id:string}|undefined;
  assert.ok(asset);assert.ok(master);
  return {directory,db,reader,ownerId,projectId,assetId:asset.id,masterId:master.id,rawImage,get reads(){return reads;},cleanup:()=>{db.close();rmSync(directory,{recursive:true,force:true});}};
}

test('4096px output stays 4096px; display is separate and never enlarges',async()=>{
  const bytes=await sample(4096,32);const master=await validateOutputMaster(bytes);
  assert.equal(master.width,4096);assert.equal(master.height,32);
  const display=await createDisplayAsset(master);assert.equal(display.width,1200);assert.equal(master.width,4096);assert.equal(display.sourceSha256,master.sha256);
  const tiny=await validateOutputMaster(await sample());assert.equal((await createDisplayAsset(tiny)).width,8);
});
test('normalization produces metadata-free oriented PNG and records original geometry',async()=>{
  const raw=await sharp(await sample(8,4)).withMetadata({orientation:6,exif:{IFD0:{ImageDescription:'SYNTHETIC_PRIVATE_METADATA'}}}).jpeg().toBuffer();
  const input=await normalizeInput(raw);assert.equal(input.width,4);assert.equal(input.height,8);assert.equal(input.sourceWidth,8);assert.equal(input.sourceOrientation,6);
  const m=await sharp(input.bytes).metadata();assert.equal(m.orientation,undefined);assert.equal(m.exif,undefined);assert.equal(m.icc,undefined);
  assert.doesNotMatch(input.bytes.toString('latin1'),/SYNTHETIC_PRIVATE_METADATA/);
});
test('PNG compression and metadata differences do not imply different pixels',async()=>{
  const original=await sample(11,5);
  const a=await normalizeInput(await sharp(original).png({compressionLevel:0}).toBuffer());
  const annotated=Buffer.concat([original.subarray(0,33),chunk('tEXt',Buffer.from('Comment\0SYNTHETIC ONLY')),original.subarray(33)]);
  const b=await validateOutputMaster(annotated);
  assert.notEqual(a.sourceSha256,b.sourceSha256);assert.equal(exactPixelEquality(a,b),true);
});
test('different pixels, dimensions or normalizer version are not exact unchanged',async()=>{
  const a=await normalizeInput(await sample());const b=await normalizeInput(await sample(8,4,'#3344cc'));
  const c=await normalizeInput(await sample(4,8));assert.equal(exactPixelEquality(a,b),false);assert.equal(exactPixelEquality(a,c),false);
  assert.equal(exactPixelEquality(a,{...a,normalizerVersion:'other'}),false);
});
for(const stage of ['input','output'] as const)test(stage+' rejects oversized, empty and mismatched file bytes',async()=>{
  const run=stage==='input'?normalizeInput:validateOutputMaster;const prefix=stage.toUpperCase();
  await assert.rejects(()=>run(Buffer.alloc(0)),new RegExp(prefix+'_EMPTY'));
  await assert.rejects(()=>run(Buffer.alloc((stage==='input'?IMAGE_LIMITS.inputBytes:IMAGE_LIMITS.outputBytes)+1)),new RegExp(prefix+'_BYTE_LIMIT'));
  await assert.rejects(()=>run(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),new RegExp(prefix+'_UNSUPPORTED_FORMAT'));
  await assert.rejects(()=>run(Buffer.from('%PDF-1.4')),new RegExp(prefix+'_UNSUPPORTED_FORMAT'));
});
test('output-specific error does not tell user to downsize their source photo',async()=>{
  try{await validateOutputMaster(Buffer.from('bad output'));assert.fail('must reject');}catch(e){assert.ok(e instanceof ImageError);assert.equal(e.stage,'output');assert.match(e.code,/OUTPUT_/);assert.doesNotMatch(e.message,/reupload|smaller|input/i);}
});
test('APNG animation is rejected before a decoder can silently select its first frame',async()=>{
  const png=await sample();const data=Buffer.alloc(8);data.writeUInt32BE(2,0);
  const animated=Buffer.concat([png.subarray(0,33),chunk('acTL',data),png.subarray(33)]);
  await assert.rejects(()=>normalizeInput(animated),/ANIMATION_UNSUPPORTED/);
  await assert.rejects(()=>validateOutputMaster(animated),/ANIMATION_UNSUPPORTED/);
});
test('oversized PNG dimensions rejected under pixel cap without decoding full image',async()=>{
  const png=await sample();const changed=Buffer.from(png);changed.writeUInt32BE(10000,16);changed.writeUInt32BE(10000,20);changed.writeUInt32BE(crc32(changed.subarray(12,29)),29);
  await assert.rejects(()=>normalizeInput(changed),/INPUT_PIXEL_LIMIT/);
});
test('truncated image with real signature is an unreadable output',async()=>{
  const b=(await sample()).subarray(0,35);await assert.rejects(()=>validateOutputMaster(b),/OUTPUT_UNREADABLE/);
});
test('native HEIC is explicitly unsupported here rather than guessed from an extension',async()=>{
  await assert.rejects(()=>normalizeInput(Buffer.from('\0\0\0\x18ftypheic synthetic')),/INPUT_UNSUPPORTED_FORMAT/);
});
test('explicit profile minimum is enforced without invented 4K output claims',async()=>{
  await assert.rejects(()=>validateOutputMaster(sample as any,{width:-1,height:2}),/INVALID_OUTPUT_PROFILE/);
  const small=await sample(); await assert.rejects(()=>validateOutputMaster(small,{width:10,height:10}),/OUTPUT_BELOW_PROFILE_MINIMUM/);
});
test('display creation verifies digest and metadata and rejects invalid dimensions',async()=>{
  const a=await validateOutputMaster(await sample());
  await assert.rejects(()=>createDisplayAsset({...a,sha256:'0'.repeat(64)}),/MASTER_DIGEST_MISMATCH/);
  await assert.rejects(()=>createDisplayAsset({...a,width:999}),/MASTER_METADATA_MISMATCH/);
  await assert.rejects(()=>createDisplayAsset(a,0),/INVALID_DISPLAY_SIZE/);
});
test('asset columns match existing schema and pixel provenance remains a separate snapshot',async()=>{
  const f=await fixture();assert.deepEqual(Object.keys(f.row).sort(),['id','owner_id','project_id','kind','mime','bytes','width','height','digest','storage_key','created_at'].sort());
  assert.ok(f.image.pixelSha256);assert.equal(Object.isFrozen(f.row),true);
});
test('authorized read is private/no-store and generation base is the selected asset',async()=>{
  const f=await fixture();const r=await readGenerationBase(f.reader,'asset-1','owner-1','project-1');
  assert.equal(r.row.id,'asset-1');assert.equal(r.headers['Cache-Control'],'private, no-store');assert.deepEqual(r.bytes,f.image.bytes);assert.equal(f.reads,1);
  assert.deepEqual(f.lastLocator,{kind:'private',assetId:'asset-1',ownerId:'owner-1',projectId:'project-1',storageKey:'storage-1'});
});
for (const [owner,project] of [['owner-2','project-1'],['owner-1','project-2']])test('cross-boundary read '+owner+'/'+project+' is zero-byte-access',async()=>{
  const f=await fixture();await assert.rejects(()=>readOwnedAsset(f.reader,'asset-1',owner,project),/ASSET_NOT_FOUND/);assert.equal(f.reads,0);
});
test('deleted project denied before and after I/O',async()=>{
  const f=await fixture();f.block();await assert.rejects(()=>readOwnedAsset(f.reader,'asset-1','owner-1','project-1'),/ASSET_NOT_FOUND/);assert.equal(f.reads,0);
  const g=await fixture();g.reader.readBytes=async()=>{g.block();return g.image.bytes;};await assert.rejects(()=>readOwnedAsset(g.reader,'asset-1','owner-1','project-1'),/ASSET_NOT_FOUND/);
});
test('deletion or immutable asset change during await cannot return old bytes',async()=>{
  for(const mode of ['gone','changed']){const f=await fixture();f.reader.readBytes=async()=>{f.setRow(mode==='gone'?null:{...f.row,digest:'0'.repeat(64)});return f.image.bytes;};await assert.rejects(()=>readOwnedAsset(f.reader,'asset-1','owner-1','project-1'),/ASSET_NOT_FOUND|ASSET_CHANGED_DURING_READ/);}
});
test('display and temporary assets cannot become generation inputs',async()=>{
  for(const kind of ['display','temporary'] as const){const f=await fixture(kind);await assert.rejects(()=>readGenerationBase(f.reader,'asset-1','owner-1','project-1'),/DISPLAY_IS_NOT_GENERATION_INPUT/);assert.equal(f.reads,0);}
});
test('digest mismatch and unsafe storage key rejected',async()=>{
  const f=await fixture();f.reader.readBytes=async()=>Buffer.from('bad');await assert.rejects(()=>readOwnedAsset(f.reader,'asset-1','owner-1','project-1'),/ASSET_DIGEST_MISMATCH/);
  const g=await fixture();g.setRow({...g.row,storage_key:'../../private'});await assert.rejects(()=>readOwnedAsset(g.reader,'asset-1','owner-1','project-1'),/ASSET_INTEGRITY_INVALID/);assert.equal(g.reads,0);
});

test('negative dimensions and invalid kind cannot pass metadata validation',async()=>{
  const f=await fixture();f.setRow({...f.row,width:-1});await assert.rejects(()=>readOwnedAsset(f.reader,'asset-1','owner-1','project-1'),/ASSET_INTEGRITY_INVALID/);assert.equal(f.reads,0);
});

test('managed PNG metadata and persisted byte count are verified against decoded bytes',async()=>{
  const f=await fixture();f.setRow({...f.row,width:f.row.width!-1});
  await assert.rejects(()=>readOwnedAsset(f.reader,'asset-1','owner-1','project-1'),/ASSET_INTEGRITY_INVALID/);assert.equal(f.reads,1);
  const g=await fixture();g.setRow({...g.row,bytes:g.row.bytes+1});
  await assert.rejects(()=>readOwnedAsset(g.reader,'asset-1','owner-1','project-1'),/ASSET_DIGEST_MISMATCH/);assert.equal(g.reads,1);
});

test('master validation rejects 16-bit samples instead of silently quantizing them',async()=>{
  const values=Buffer.alloc(2*2*3*2);
  [0x0101,0x7f03,0xff00,0x2345,0x8001,0xfeff].forEach((value,index)=>values.writeUInt16LE(value,index*2));
  const png=await sharp(values,{raw:{width:2,height:1,channels:3,depth:'ushort'} as any}).toColourspace('rgb16').png({bitdepth:16} as any).toBuffer();
  const meta=await sharp(png).metadata();assert.ok(meta.depth==='ushort'||meta.bitsPerSample===16);
  await assert.rejects(()=>validateOutputMaster(png),e=>e instanceof ImageError&&e.code==='OUTPUT_UNSUPPORTED_PRECISION');
});

test('8-bit normalization retains transparent and partially transparent RGBA samples',async()=>{
  const rgba=Buffer.from([250,20,30,0,80,130,210,64,35,180,90,128,5,6,7,255]);
  const png=await sharp(rgba,{raw:{width:4,height:1,channels:4}}).png().toBuffer();
  const image=await validateOutputMaster(png);
  const decoded=await sharp(image.bytes).ensureAlpha().raw().toBuffer();
  assert.deepEqual(decoded,rgba);
});

test('F03 migrated legacy image reads as a transient normalized asset with provenance',async()=>{
  const f=await migratedLegacyFixture();
  try{
    const result=await readOwnedAsset(f.reader,f.assetId,f.ownerId,f.projectId);
    assert.equal(result.persistedRow.mime,'application/octet-stream');assert.equal(result.persistedRow.width,null);assert.equal(result.persistedRow.height,null);
    assert.equal(result.compatibleRow.mime,'image/png');assert.equal(result.compatibleRow.width,7);assert.equal(result.compatibleRow.height,3);
    assert.equal(result.provenance.rawSha256,sha(f.rawImage));assert.equal(result.provenance.canonicalSha256,result.image.sha256);
    assert.equal(result.provenance.pixelSha256,result.image.pixelSha256);assert.equal(result.image.normalizerVersion,'form-srgb-rgba-v1');
    assert.deepEqual(result.bytes,result.image.bytes);assert.equal(f.reads,1);
    const master=await readOwnedAsset(f.reader,f.masterId,f.ownerId,f.projectId);
    assert.equal(master.persistedRow.kind,'master');assert.equal(master.compatibleRow.mime,'image/png');assert.deepEqual(master.bytes,master.image.bytes);assert.equal(f.reads,2);
  }finally{f.cleanup();}
});

test('legacy reads are scoped to the requested owner and project before storage access',async()=>{
  const f=await migratedLegacyFixture();
  try{
    await assert.rejects(()=>readOwnedAsset(f.reader,f.assetId,'legacy-owner-ffffffffffffffffffffffff',f.projectId),/ASSET_NOT_FOUND/);
    await assert.rejects(()=>readOwnedAsset(f.reader,f.assetId,f.ownerId,'legacy-project-aaaaaaaaaaaaaaaaaaaaaaaa'),/ASSET_NOT_FOUND/);
    assert.equal(f.reads,0);
  }finally{f.cleanup();}
});

test('invalid, foreign-owner and traversal storage locators are rejected before reading bytes',async()=>{
  const f=await migratedLegacyFixture();
  try{
    const keys=['file:///etc/passwd','https://example.invalid/image','legacy://synthetic-cookie-a/legacy-image-a',`legacy://legacy-owner-${'f'.repeat(24)}/legacy-image-a`,'legacy://legacy-owner-aaaaaaaaaaaaaaaaaaaaaaaa/../../etc/passwd'];
    for(const key of keys){
      f.db.prepare('UPDATE assets SET storage_key=? WHERE id=?').run(key,f.assetId);
      await assert.rejects(()=>readOwnedAsset(f.reader,f.assetId,f.ownerId,f.projectId),e=>e instanceof AssetError&&e.code==='ASSET_INTEGRITY_INVALID');
    }
    assert.equal(f.reads,0);
  }finally{f.cleanup();}
});

test('legacy locator cannot authorize non-source asset kinds',async()=>{
  const f=await migratedLegacyFixture();
  try{
    f.db.prepare("UPDATE assets SET kind='display' WHERE id=?").run(f.masterId);
    await assert.rejects(()=>readOwnedAsset(f.reader,f.masterId,f.ownerId,f.projectId),e=>e instanceof AssetError&&e.code==='ASSET_INTEGRITY_INVALID');
    assert.equal(f.reads,0);
  }finally{f.cleanup();}
});

test('storage reader exceptions are mapped to fixed errors without leaking internals',async()=>{
  const f=await fixture();
  const reader:AssetReader={...f.reader,readBytes:async()=>{throw new Error('/private/data/form.sqlite SELECT token=synthetic-secret');}};
  await assert.rejects(()=>readOwnedAsset(reader,'asset-1','owner-1','project-1'),e=>e instanceof AssetError&&e.code==='ASSET_READ_FAILED'&&!/private|SELECT|token|synthetic-secret/.test(e.message));
  const failingProject:AssetReader={...f.reader,canReadProject:async()=>{throw new Error('/private/project');}};
  await assert.rejects(()=>readOwnedAsset(failingProject,'asset-1','owner-1','project-1'),e=>e instanceof AssetError&&e.code==='ASSET_READ_FAILED'&&!/private/.test(e.message));
  const failingRow:AssetReader={...f.reader,findOwned:async()=>{throw new Error('SQL token=secret');}};
  await assert.rejects(()=>readOwnedAsset(failingRow,'asset-1','owner-1','project-1'),e=>e instanceof AssetError&&e.code==='ASSET_READ_FAILED'&&!/SQL|token|secret/.test(e.message));
});

test('project deletion during legacy normalization is checked before returning bytes',async()=>{
  const f=await migratedLegacyFixture();
  try{
    let checks=0;
    const reader:AssetReader={...f.reader,canReadProject:async()=>++checks<3};
    await assert.rejects(()=>readOwnedAsset(reader,f.assetId,f.ownerId,f.projectId),e=>e instanceof AssetError&&e.code==='ASSET_NOT_FOUND');
    assert.equal(checks,3);assert.equal(f.reads,1);
  }finally{f.cleanup();}
});
