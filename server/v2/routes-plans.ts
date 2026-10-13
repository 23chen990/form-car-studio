import express,{type NextFunction,type Request,type RequestHandler,type Response} from 'express';
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {ConsentCatalog} from './consents.js';
import {createPlanService,PlanError,type PlanConfiguration} from './plans.js';

export type PlanActorResolver=(request:Request)=>string|null|undefined|Promise<string|null|undefined>;
export interface PlansRouterOptions {
  db:DatabaseSync;actorResolver:PlanActorResolver;consentCatalog?:ConsentCatalog|null;config?:PlanConfiguration;getConfig?:()=>PlanConfiguration;clock?:()=>Date;id?:()=>string;
}
class RouteError extends Error {constructor(readonly code:string,readonly status:number){super(code);}}
const asyncRoute=(fn:(req:Request,res:Response,next:NextFunction)=>unknown):RequestHandler=>(req,res,next)=>{Promise.resolve(fn(req,res,next)).catch(next);};
function errorResult(error:unknown){
  let status=500,code='REQUEST_FAILED';
  if(error instanceof RouteError||error instanceof PlanError){status=error.status;code=error.code;}
  const e=error as {type?:string};
  if(!(error instanceof RouteError||error instanceof PlanError)){
    if(e?.type==='entity.too.large'){status=413;code='REQUEST_TOO_LARGE';}
    else if(e?.type==='entity.parse.failed'||e?.type==='request.size.invalid'){status=400;code='INVALID_REQUEST';}
  }
  const messages:Record<string,string>={AUTH_REQUIRED:'Sign in is required.',PROJECT_NOT_FOUND:'Project not found.',SOURCE_NOT_FOUND:'The selected source is unavailable.',SOURCE_CHANGED:'The selected source changed. Choose it again.',SOURCE_INTEGRITY_INVALID:'The selected photo could not be verified.',SOURCE_PROVENANCE_INVALID:'The selected source could not be verified.',DEMO_UNAVAILABLE:'This demo is unavailable.',SOURCE_NOT_ALLOWED:'This source is not available for editing.',PLAN_UNAVAILABLE:'Editing quotes are unavailable right now.',PLAN_CONFIGURATION_CHANGED:'Editing settings changed. Request a new quote.',CONSENT_INVALID:'Current sharing consent for this provider is required.',ORIGINAL_REFERENCE_UNSUPPORTED:'Restoring the original is not available for this provider.',NO_EFFECTIVE_CHANGE:'Choose a change before requesting a quote.',EXPLORE_OVERRIDES_UNSUPPORTED:'Preset edits cannot be changed in this request.',INVALID_REQUEST:'The request is invalid.',REQUEST_TOO_LARGE:'The request is too large.',REQUEST_FAILED:'The request could not be completed.'};
  messages.INPUT_TOO_LARGE_FOR_PROVIDER='The selected photo is too large for this editing option.';
  return {status,code,message:messages[code]??'The request could not be completed.',retryable:code==='PLAN_UNAVAILABLE'||code==='PLAN_CONFIGURATION_CHANGED'||code==='REQUEST_FAILED',requestId:randomUUID()};
}

/** Exported for explicit F08 integration; this router is intentionally not mounted by server/index.ts. */
export function createPlansRouter(options:PlansRouterOptions){
  const router=express.Router(),service=createPlanService(options),resolver=options.actorResolver;
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
  const withActor:RequestHandler=asyncRoute(async(req,res,next)=>{
    let owner:string|null|undefined=null;try{if(typeof resolver==='function')owner=await resolver(req);}catch{owner=null;}
    if(!owner){next(new RouteError('AUTH_REQUIRED',401));return;}res.locals.ownerId=owner;next();
  });
  const json=express.json({limit:16*1024,strict:true});
  router.post('/projects/:projectId/plans',withActor,json,asyncRoute(async(req,res)=>{
    const projectId=Array.isArray(req.params.projectId)?req.params.projectId[0]:req.params.projectId;
    const result=await service.quote(res.locals.ownerId as string,projectId,req.get('X-Form-Consent-Id')??'',req.body);
    res.status(201).json(result);
  }));
  router.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
    if(res.headersSent)return;const result=errorResult(error);res.status(result.status).set('Cache-Control','private, no-store').json({code:result.code,message:result.message,retryable:result.retryable,requestId:result.requestId});
  });
  return router;
}
