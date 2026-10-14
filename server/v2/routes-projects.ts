import express,{type NextFunction,type Request,type RequestHandler,type Response} from 'express';
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {AssetError} from './assets.js';
import {ConsentError,type ConsentCatalog} from './consents.js';
import {MAX_MULTIPART_BYTES,ProjectError,createProjectService,type DemoSample} from './projects.js';

export type ActorResolver=(request:Request)=>string|null|undefined|Promise<string|null|undefined>;
export type ProjectsRouterOptions={db:DatabaseSync;actorResolver:ActorResolver;consentCatalog?:ConsentCatalog|null;storageQuotaBytes?:number|null;demoRegistry?:readonly DemoSample[];maxConcurrentUploads?:number};
class RouteError extends Error{constructor(readonly code:string,readonly status:number){super(code);}}
const asyncRoute=(fn:(req:Request,res:Response,next:NextFunction)=>unknown):RequestHandler=>(req,res,next)=>{Promise.resolve(fn(req,res,next)).catch(next);};
function release(res:Response){const fn=res.locals.releaseUpload as (()=>void)|undefined;if(fn){delete res.locals.releaseUpload;fn();}}
function actor(res:Response){return res.locals.ownerId as string;}
function errorResult(error:unknown){
  let status=500,code='REQUEST_FAILED';
  if(error instanceof RouteError||error instanceof ProjectError||error instanceof ConsentError){status=error.status;code=error.code;}
  else if(error instanceof AssetError){status=404;code='ASSET_NOT_FOUND';}
  const e=error as {type?:string;status?:number};
  if(!(error instanceof RouteError||error instanceof ProjectError||error instanceof ConsentError||error instanceof AssetError)){
    if(e?.type==='entity.too.large'){status=413;code='UPLOAD_TOO_LARGE';}
    else if(e?.type==='encoding.unsupported'){status=415;code='UNSUPPORTED_CONTENT_ENCODING';}
    else if(e?.type==='entity.parse.failed'||e?.type==='request.size.invalid'){status=400;code='INVALID_REQUEST';}
  }
  const messages:Record<string,string>={AUTH_REQUIRED:'Sign in is required.',INVALID_CONSENT_REQUEST:'Consent details are invalid.',CONSENT_ACK_REQUIRED:'Required acknowledgments are missing.',CONSENT_UNAVAILABLE:'Consent is unavailable right now.',CONSENT_INVALID:'Current consent is required.',MULTIPART_REQUIRED:'Choose a photo to upload.',INVALID_MULTIPART:'The upload request is invalid.',UPLOAD_REQUIRED:'Choose a photo to upload.',UPLOAD_TOO_LARGE:'This photo is too large to upload.',UPLOAD_INVALID:'This photo cannot be uploaded.',INVALID_IMAGE:'This photo cannot be read.',INPUT_UNSUPPORTED_FORMAT:'This photo format is not supported. Choose another photo.',OUTPUT_UNSUPPORTED_FORMAT:'This image format is not supported. Choose another photo.',INPUT_PIXEL_LIMIT:'This photo is too large to process. Choose a smaller image.',OUTPUT_PIXEL_LIMIT:'This image is too large to process.',INPUT_UNREADABLE:'This photo could not be read. Try exporting it again.',OUTPUT_UNREADABLE:'This image could not be read.',ANIMATION_UNSUPPORTED:'Animated images are not supported. Choose a still photo.',INPUT_UNSUPPORTED_PRECISION:'This photo uses unsupported color precision. Export an 8-bit image.',OUTPUT_UNSUPPORTED_PRECISION:'This image uses unsupported color precision.',INPUT_NORMALIZED_BYTE_LIMIT:'This photo becomes too large after conversion. Choose another photo.',OUTPUT_NORMALIZED_BYTE_LIMIT:'This image becomes too large after conversion.',INPUT_EMPTY:'Choose a photo to upload.',OUTPUT_EMPTY:'The image could not be prepared.',INPUT_BYTE_LIMIT:'This photo is too large to upload.',OUTPUT_BYTE_LIMIT:'This image is too large to prepare.',INVALID_DISPLAY_SIZE:'The photo preview could not be prepared.',MASTER_DIGEST_MISMATCH:'The image could not be verified.',MASTER_METADATA_MISMATCH:'The image could not be verified.',DEMO_UNAVAILABLE:'This demo is unavailable.',INVALID_SOURCE_KIND:'The selected source is invalid.',STORAGE_QUOTA_UNAVAILABLE:'Project storage is unavailable.',QUOTA_STATE_INVALID:'Project storage is temporarily unavailable.',QUOTA_EXCEEDED:'Storage limit reached.',UPLOAD_BUSY:'Another upload is in progress.',UNSUPPORTED_CONTENT_ENCODING:'The upload encoding is unsupported.',INVALID_REQUEST:'The request is invalid.',ASSET_NOT_FOUND:'Asset not found.',PROJECT_CREATE_FAILED:'Project could not be saved.',REQUEST_FAILED:'The request could not be completed.'};
  return {status,code,message:messages[code]??'The request could not be completed.',retryable:code==='UPLOAD_BUSY'||code==='PROJECT_CREATE_FAILED'||code==='REQUEST_FAILED',requestId:randomUUID()};
}
const jsonBody=express.json({limit:4096,strict:true});

/** Exported for explicit F07 integration; server/index.ts intentionally does not mount it. */
export function createProjectsRouter(options:ProjectsRouterOptions){
  const router=express.Router(),service=createProjectService({...options,consentCatalog:options.consentCatalog??undefined});
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
  const resolver=options.actorResolver;let active=0;const configuredMax=Number(options.maxConcurrentUploads);const max=Number.isSafeInteger(configuredMax)&&configuredMax>0?Math.min(configuredMax,2):1;
  const withActor:RequestHandler=asyncRoute(async(req,res,next)=>{
    let owner:string|null|undefined=null;try{if(typeof resolver==='function')owner=await resolver(req);}catch{owner=null;}
    if(!owner){next(new RouteError('AUTH_REQUIRED',401));return;}res.locals.ownerId=owner;next();
  });
  router.post('/consents',withActor,jsonBody,asyncRoute(async(req,res)=>{
    const body=req.body as Record<string,unknown>|undefined,allowed=['policyId','acknowledgePhotoRights','acknowledgeUploadStorage','acknowledgeSharing'];
    if(!body||typeof body!=='object'||Object.keys(body).some(k=>!allowed.includes(k))||typeof body.policyId!=='string')throw new RouteError('INVALID_CONSENT_REQUEST',400);
    const result=service.issueConsent(actor(res),body as Parameters<typeof service.issueConsent>[1]);res.status(201).json(result);
  }));
  const uploadGate:RequestHandler=asyncRoute(async(req,res,next)=>{
    const consentId=req.get('X-Form-Consent-Id')??'';service.preflight(actor(res),consentId);
    const encoding=req.get('Content-Encoding');if(encoding&&encoding.toLowerCase()!=='identity')throw new RouteError('UNSUPPORTED_CONTENT_ENCODING',415);
    const content=req.get('Content-Type')??'';if(!/^multipart\/form-data\s*;\s*boundary=[^;\s]{1,200}(?:;.*)?$/i.test(content))throw new RouteError('MULTIPART_REQUIRED',415);
    const length=req.get('Content-Length');if(length!==undefined){if(!/^\d+$/.test(length))throw new RouteError('INVALID_REQUEST',400);if(Number(length)>MAX_MULTIPART_BYTES)throw new RouteError('UPLOAD_TOO_LARGE',413);}
    if(active>=max)throw new RouteError('UPLOAD_BUSY',429);active++;let done=false;res.locals.releaseUpload=()=>{if(!done){done=true;active--;}};next();
  });
  const raw=express.raw({type:'multipart/form-data',limit:MAX_MULTIPART_BYTES,inflate:false});
  const parseRaw:RequestHandler=(req,res,next)=>raw(req,res,error=>{if(error){release(res);next(error);}else next();});
  router.post('/projects',withActor,uploadGate,parseRaw,asyncRoute(async(req,res)=>{
    try{
      if(!Buffer.isBuffer(req.body))throw new RouteError('INVALID_MULTIPART',400);
      let form:FormData;try{form=await new Request('http://form.invalid/api/v2/projects',{method:'POST',headers:{'content-type':req.get('Content-Type')!},body:req.body as never}).formData();}
      catch{throw new RouteError('INVALID_MULTIPART',400);}
      const allowed=new Set(['name','file','demoId']);for(const key of form.keys())if(!allowed.has(key))throw new RouteError('INVALID_MULTIPART',400);
      const names=form.getAll('name'),files=form.getAll('file'),demos=form.getAll('demoId');
      if(names.length>1||files.length>1||demos.length>1||names.some(x=>typeof x!=='string')||demos.some(x=>typeof x!=='string'))throw new RouteError('INVALID_MULTIPART',400);
      const name=typeof names[0]==='string'?names[0]:'';if(name.length>240)throw new RouteError('INVALID_MULTIPART',400);
      let bytes:Buffer,sourceKind:'user_upload'|'licensed_demo',licenseRegistryId:string|undefined;
      if(demos.length){if(files.length||typeof demos[0]!=='string'||!demos[0])throw new RouteError('INVALID_MULTIPART',400);
        const sample=service.sample(demos[0]);if(!sample)throw new RouteError('DEMO_UNAVAILABLE',403);bytes=sample.bytes;sourceKind='licensed_demo';licenseRegistryId=sample.licenseRegistryId;
      }else{
        if(files.length!==1||typeof files[0]==='string'||!(files[0] instanceof File))throw new RouteError('UPLOAD_REQUIRED',400);
        if(files[0].size>10*1024*1024)throw new RouteError('UPLOAD_TOO_LARGE',413);bytes=Buffer.from(await files[0].arrayBuffer());sourceKind='user_upload';
      }
      const consentId=req.get('X-Form-Consent-Id')!;const result=await service.create(actor(res),consentId,bytes,name,sourceKind,licenseRegistryId);res.status(201).json(result);
    }finally{release(res);}
  }));
  router.get('/assets/:assetId',withActor,asyncRoute(async(req,res)=>{
    const id=Array.isArray(req.params.assetId)?req.params.assetId[0]:req.params.assetId;
    const {projectId,result}=await service.readAssetById(actor(res),id);
    if(!service.canSendAsset(actor(res),projectId,id))throw new AssetError('ASSET_NOT_FOUND');
    for(const [key,value] of Object.entries(result.headers))res.setHeader(key,value);res.status(200).end(result.bytes);
  }));
  // Keep scoped reads as an internal compatibility path; frozen clients use /assets/:id.
  router.get('/projects/:projectId/assets/:assetId',withActor,asyncRoute(async(req,res)=>{
    const projectId=Array.isArray(req.params.projectId)?req.params.projectId[0]:req.params.projectId,assetId=Array.isArray(req.params.assetId)?req.params.assetId[0]:req.params.assetId;
    const result=await service.readAsset(actor(res),projectId,assetId);
    // No await follows this synchronous owner/project/tombstone/row check and the send.
    if(!service.canSendAsset(actor(res),projectId,assetId))throw new AssetError('ASSET_NOT_FOUND');
    for(const [key,value] of Object.entries(result.headers))res.setHeader(key,value);res.status(200).end(result.bytes);
  }));
  router.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{release(res);if(res.headersSent)return;
    const result=errorResult(error);res.status(result.status).set('Cache-Control','private, no-store').json({code:result.code,message:result.message,retryable:result.retryable,requestId:result.requestId});
  });
  return router;
}
