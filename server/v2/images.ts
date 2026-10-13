/** F06 draft. Synthetic-tested pixel/byte handling; no model, EXIF retention or DB writes. */
import sharp from 'sharp';
import { createHash } from 'node:crypto';

export const NORMALIZER_VERSION = 'form-srgb-rgba-v1';
export const IMAGE_LIMITS = Object.freeze({inputBytes:10*1024*1024, outputBytes:32*1024*1024, pixels:40_000_000, displayEdge:1200});
export type ImageStage = 'input' | 'output' | 'display';
export class ImageError extends Error {
  constructor(readonly code: string, readonly stage: ImageStage) { super(code); this.name='ImageError'; }
}
export interface ImageAsset {
  bytes: Buffer; mime: 'image/png'; width: number; height: number;
  sha256: string; pixelSha256: string; normalizerVersion: string;
  sourceSha256: string; sourceWidth: number; sourceHeight: number; sourceFormat: string;
  sourceOrientation: number | null;
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const check = (ok: unknown, code: string, stage: ImageStage) => {if(!ok)throw new ImageError(code,stage);};
function sniff(bytes: Buffer): string | null {
  if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpeg';
  if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'webp';
  if(bytes.length>=6&&/^GIF8[79]a$/.test(bytes.toString('ascii',0,6)))return 'gif';
  return null;
}
function apng(bytes: Buffer): boolean {
  let pos=8;
  while(pos+12<=bytes.length) {
    const size=bytes.readUInt32BE(pos); if(size>bytes.length-pos-12)break;
    if(bytes.toString('ascii',pos+4,pos+8)==='acTL')return true;
    pos+=size+12;
  }
  return false;
}
function byteGuard(bytes: Buffer, stage: ImageStage) {
  check(Buffer.isBuffer(bytes)&&bytes.length>0,`${stage.toUpperCase()}_EMPTY`,stage);
  const limit=stage==='input'?IMAGE_LIMITS.inputBytes:IMAGE_LIMITS.outputBytes;
  check(bytes.length<=limit,`${stage.toUpperCase()}_BYTE_LIMIT`,stage);
  const format=sniff(bytes);
  check(format!==null,`${stage.toUpperCase()}_UNSUPPORTED_FORMAT`,stage);
  check(!(format==='png'&&apng(bytes)),'ANIMATION_UNSUPPORTED',stage);
}
function pixelHash(width: number,height: number,rgba: Buffer): string {
  return createHash('sha256').update(`${NORMALIZER_VERSION}\0${width}x${height}\0RGBA8\0`).update(rgba).digest('hex');
}
async function normalize(bytes: Buffer, stage: 'input'|'output'): Promise<ImageAsset> {
  byteGuard(bytes,stage);
  try {
    const meta=await sharp(bytes,{limitInputPixels:IMAGE_LIMITS.pixels,failOn:'error',animated:true}).metadata();
    check((meta.pages??1)===1,'ANIMATION_UNSUPPORTED',stage);
    check(['png','jpeg','webp'].includes(meta.format??''),`${stage.toUpperCase()}_UNSUPPORTED_FORMAT`,stage);
    check(!!meta.width&&!!meta.height,`${stage.toUpperCase()}_UNREADABLE`,stage);
    check(meta.width!*meta.height!<=IMAGE_LIMITS.pixels,`${stage.toUpperCase()}_PIXEL_LIMIT`,stage);
    // Masters are lossless canonical PNGs; converting >8-bit input to RGBA8 would silently lose source precision.
    check((meta.bitsPerSample??0)<=8&&(meta.depth===undefined||meta.depth==='uchar'),`${stage.toUpperCase()}_UNSUPPORTED_PRECISION`,stage);
    // Decode once under the pixel cap, orient, normalize color and alpha; never resize here.
    const {data,info}=await sharp(bytes,{limitInputPixels:IMAGE_LIMITS.pixels,failOn:'error'})
      .rotate().toColourspace('srgb').ensureAlpha().raw({depth:'uchar'}).toBuffer({resolveWithObject:true});
    check(info.channels===4&&info.width*info.height<=IMAGE_LIMITS.pixels,`${stage.toUpperCase()}_PIXEL_LIMIT`,stage);
    const output=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
    check(output.length<=IMAGE_LIMITS.outputBytes,`${stage.toUpperCase()}_NORMALIZED_BYTE_LIMIT`,stage);
    return {bytes:output,mime:'image/png',width:info.width,height:info.height,sha256:sha(output),
      pixelSha256:pixelHash(info.width,info.height,data),normalizerVersion:NORMALIZER_VERSION,
      sourceSha256:sha(bytes),sourceWidth:meta.width!,sourceHeight:meta.height!,sourceFormat:meta.format!,sourceOrientation:meta.orientation??null};
  } catch(error) {
    if(error instanceof ImageError)throw error;
    // Do not expose codec paths, raw EXIF, or misleading input instructions for a bad model output.
    const pixels=error instanceof Error&&/pixel limit/i.test(error.message);
    throw new ImageError(`${stage.toUpperCase()}_${pixels?'PIXEL_LIMIT':'UNREADABLE'}`,stage);
  }
}
export const normalizeInput=(bytes: Buffer): Promise<ImageAsset>=>normalize(bytes,'input');
export async function validateOutputMaster(bytes: Buffer, minimum?: {width:number;height:number}): Promise<ImageAsset> {
  if(minimum)check(Number.isSafeInteger(minimum.width)&&minimum.width>0&&Number.isSafeInteger(minimum.height)&&minimum.height>0,'INVALID_OUTPUT_PROFILE','output');
  const master=await normalize(bytes,'output');
  if(minimum)check(master.width>=minimum.width&&master.height>=minimum.height,'OUTPUT_BELOW_PROFILE_MINIMUM','output');
  return master;
}
export async function createDisplayAsset(master: ImageAsset,maxEdge: number=IMAGE_LIMITS.displayEdge): Promise<ImageAsset> {
  check(Number.isSafeInteger(maxEdge)&&maxEdge>0&&maxEdge<=2400,'INVALID_DISPLAY_SIZE','display');
  check(master.sha256===sha(master.bytes),'MASTER_DIGEST_MISMATCH','display');
  // Revalidate bytes so callers cannot bypass limits with forged metadata.
  const verified=await validateOutputMaster(master.bytes);
  check(verified.width===master.width&&verified.height===master.height&&verified.pixelSha256===master.pixelSha256,'MASTER_METADATA_MISMATCH','display');
  const small=await sharp(verified.bytes,{limitInputPixels:IMAGE_LIMITS.pixels,failOn:'error'})
    .resize({width:maxEdge,height:maxEdge,fit:'inside',withoutEnlargement:true}).png().toBuffer();
  const display=await validateOutputMaster(small);
  return {...display,sourceSha256:master.sha256,sourceWidth:master.width,sourceHeight:master.height,sourceFormat:master.mime};
}
export function exactPixelEquality(a: ImageAsset,b: ImageAsset): boolean {
  // Only accepts server-produced ImageAsset records; this is not an image-similarity/identity classifier.
  return a.normalizerVersion===NORMALIZER_VERSION&&b.normalizerVersion===NORMALIZER_VERSION&&a.width===b.width&&a.height===b.height&&a.pixelSha256===b.pixelSha256;
}
