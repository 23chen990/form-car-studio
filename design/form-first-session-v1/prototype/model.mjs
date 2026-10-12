/** UX reference model ONLY. Not an authorizer, wallet, provider, or production adapter. */
export const STYLES = Object.freeze({
  sport: {name:'Street Sport', line:'Deep blue. Warm bronze wheels.', body:'blue', wheel:'bronze'},
  clean: {name:'Quiet Detail', line:'Original paint. A darker wheel finish.', body:'silver', wheel:'graphite'},
  color: {name:'Color Story', line:'Forest green. Bright silver wheels.', body:'green', wheel:'silver'}
});
export const COLORS = Object.freeze({silver:'#b9c1bd',blue:'#3c687d',green:'#3e6659',red:'#8f3e40',bronze:'#b99769',graphite:'#404844'});
export const ACTIVE = ['queued','processing','uncertain'];
export function initial(policy='paid') {
  return {v:1, policy:policy==='trial'?'trial':'paid',route:'discover',sheet:null,source:null,
    draft:{style:'sport',operation:'explore',base:'original',body:'blue',wheel:'bronze'},
    signedIn:false,consent:false,balance:0,trialUsed:false,online:true,history:[],selected:null,
    job:null,purchase:null,appliedPurchases:[],serial:0,submissions:0,message:null,problem:null};
}
export function active(s){return !!s.job && ACTIVE.includes(s.job.phase);}
export function baseRecipe(s){return s.history.find(x=>x.id===s.draft.base)?.recipe || {body:'silver',wheel:'silver'};}
export function needsChange(s){const b=baseRecipe(s);return b.body!==s.draft.body || b.wheel!==s.draft.wheel;}
export function primary(s){
  if(s.source?.kind==='local')return {label:'Your photo stays on this device',disabled:true,reason:'This study cannot edit your photo. Use the illustrated example to test the flow.'};
  if(!s.source)return {label:'Choose a photo',disabled:true,reason:'Choose a photo or use the illustrated example.'};
  if(active(s))return {label:'View your current request',disabled:false,action:'task'};
  if(!s.online)return {label:'Reconnect to continue',disabled:true,reason:'Your selection is still here. No request has been sent.'};
  if(!needsChange(s))return {label:'Select a change',disabled:true,reason:'Choose a different color. The base image has not changed.'};
  if(!s.signedIn)return {label:'Continue to your account',disabled:false,action:'auth'};
  if(!s.consent)return {label:'Review photo use',disabled:false,action:'consent'};
  if(s.balance<1){
    if(s.policy==='trial'&&!s.trialUsed)return {label:'Check trial availability',disabled:false,action:'trial'};
    return {label:'See credit packs',disabled:false,action:'purchase'};
  }
  return {label:'Create 1 example - 1 demo credit',disabled:false,action:'submit'};
}
function clone(s){return structuredClone(s);}
export function reduce(before,e){
  if(!e||typeof e.type!=='string')return before;
  const s=clone(before); s.message=null;
  const notify=t=>{s.message=t;return s;};
  switch(e.type){
    case 'NAV':
      if(!['discover','garage','review','task','result','edit','photo'].includes(e.route))return before;
      if(e.route==='task'&&!s.job)return before;
      if(['result','edit'].includes(e.route)&&!s.history.some(x=>x.id===s.selected))return before;
      s.route=e.route;s.sheet=null;return s;
    case 'STYLE':
      if(!STYLES[e.id])return before;
      s.draft={style:e.id,operation:'explore',base:'original',body:STYLES[e.id].body,wheel:STYLES[e.id].wheel};return s;
    case 'START':
      if(e.detail){s.draft={style:null,operation:'detail',base:'original',body:'silver',wheel:'silver'};}
      s.route='photo';return s;
    case 'SOURCE':
      if(!['sample','local'].includes(e.kind))return before;
      s.source={kind:e.kind};s.consent=false;s.draft.base='original';s.route=e.kind==='sample'&&s.draft.operation==='detail'?'edit':'review';return s;
    case 'REMOVE_SOURCE':s.source=null;s.consent=false;s.route='photo';return s;
    case 'NEXT':{
      const p=primary(s);if(p.disabled)return notify(p.reason||'Not available.');
      if(p.action==='task'){s.route='task';return s;}
      if(p.action==='submit')return reduce(s,{type:'SUBMIT',now:e.now});
      s.sheet=p.action;return s;
    }
    case 'CLOSE':s.sheet=null;return s;
    case 'SHEET':
      if(!['help','purchase','problem','export','reset'].includes(e.id))return before;
      s.sheet=e.id;return s;
    case 'AUTH_OK':
      if(s.sheet!=='auth')return before;
      s.signedIn=true;s.sheet=null;return notify('Demo account ready. Your photo and choices are unchanged.');
    case 'CONSENT_OK':
      if(s.sheet!=='consent'||s.source?.kind!=='sample')return before;
      s.consent=true;s.sheet=null;return notify('Example flow only. No photo is transmitted.');
    case 'TRIAL_OK':
      if(s.policy!=='trial'||s.trialUsed||!s.signedIn||!s.consent||!s.online||s.sheet!=='trial')return before;
      s.trialUsed=true;s.balance+=1;s.sheet=null;return notify('1 demo trial credit added. This is not an active offer.');
    case 'BUY':
      if(!s.signedIn||!s.online||s.sheet!=='purchase'||![5,15].includes(e.units)||['pending','verifying'].includes(s.purchase?.phase))return before;
      s.serial++;s.purchase={id:'purchase-'+s.serial,units:e.units,phase:'pending'};return s;
    case 'PURCHASE_VERIFY':
      if(s.purchase?.phase!=='pending')return before;
      s.purchase.phase='verifying';return s;
    case 'PURCHASE_OK':
      if(!s.purchase||s.purchase.phase!=='verifying'||s.appliedPurchases.includes(s.purchase.id))return before;
      s.appliedPurchases.push(s.purchase.id);s.balance+=s.purchase.units;s.purchase.phase='complete';s.sheet=null;s.route='review';
      return notify('Demo credits added. Review your changes before creating.');
    case 'PURCHASE_CANCEL':
      if(s.purchase?.phase!=='pending')return before;
      s.purchase=null;return notify('Purchase cancelled. Nothing was charged; your choices remain.');
    case 'COLOR':
      if(!['body','wheel'].includes(e.field)||!COLORS[e.value])return before;
      if(e.field==='body'&&!['blue','green','red','silver'].includes(e.value))return before;
      if(e.field==='wheel'&&!['bronze','graphite','silver'].includes(e.value))return before;
      s.draft[e.field]=e.value;return s;
    case 'RESET_DRAFT':{
      const b=baseRecipe(s);s.draft.body=b.body;s.draft.wheel=b.wheel;return s;
    }
    case 'SELECT_VERSION':
      if(!s.history.some(x=>x.id===e.id))return before;
      s.selected=e.id;s.route='result';return s;
    case 'REFINE':{
      const v=s.history.find(x=>x.id===s.selected);if(!v)return before;
      s.draft={base:v.id,operation:'detail',style:null,...v.recipe};s.route='edit';s.source={kind:'sample'};return s;
    }
    case 'FAVORITE':{
      const v=s.history.find(x=>x.id===s.selected);if(!v)return before;
      v.favorite=!v.favorite;return notify(v.favorite?'Added to demo favorites.':'Removed from demo favorites.');
    }
    case 'SUBMIT':{
      if(primary(s).action!=='submit'||primary(s).disabled||!Number.isFinite(e.now))return before;
      s.serial++;s.submissions++;s.balance-=1;
      s.job={id:'job-'+s.serial,phase:'queued',createdAt:e.now,recipe:{body:s.draft.body,wheel:s.draft.wheel},base:s.draft.base,style:s.draft.style,cost:1,released:false,resultId:null};
      s.route='task';return s;
    }
    case 'PROCESS':
      if(s.job?.phase!=='queued')return before;
      s.job.phase='processing';return s;
    case 'UNCERTAIN':
      if(s.job?.phase!=='processing')return before;
      s.job.phase='uncertain';return s;
    case 'COMPLETE':
      if(!s.job||!['processing','uncertain'].includes(s.job.phase))return before;
      s.job.phase='succeeded';s.job.resultId='look-'+s.job.id;
      s.history.push({id:s.job.resultId,jobId:s.job.id,base:s.job.base,recipe:{...s.job.recipe},style:s.job.style,favorite:false});
      s.selected=s.job.resultId;if(s.route==='task')s.route='result';return s;
    case 'FAIL':
    case 'CANCEL':{
      if(!active(s))return before;
      if(e.type==='CANCEL'&&s.job.phase!=='queued')return notify('Processing has started. Leave this screen and return later.');
      s.job.phase=e.type==='CANCEL'?'cancelled':'failed';s.job.reason=e.reason==='unchanged'?'unchanged':'technical';
      if(!s.job.released){s.balance+=s.job.cost;s.job.released=true;}return s;
    }
    case 'RETRY_REVIEW':
      if(!s.job||!['failed','cancelled'].includes(s.job.phase))return before;
      s.draft={...s.draft,base:s.job.base,style:s.job.style,...s.job.recipe};s.route='review';return s;
    case 'NETWORK':s.online=e.online===true;return s;
    case 'REPORT':
      if(s.sheet!=='problem'||!['identity','not_applied','artifacts','preference'].includes(e.category))return before;
      s.problem={version:s.selected,category:e.category};s.sheet=null;return notify('Feedback recorded in this study. No automatic credit or payment refund.');
    case 'LOGOUT':return {...initial(s.policy),message:'Demo account and local study history cleared.'};
    default:return before;
  }
}
/** No tokens, photos, file names or personal metadata are persisted by this study. */
export function serialize(s){const x=clone(s);x.sheet=null;if(x.source?.kind==='local'){x.source=null;x.route='photo';x.consent=false;x.message='Please reselect your photo. It was never uploaded or saved.';}return JSON.stringify(x);}
export function restore(raw){
  try{const x=JSON.parse(raw);if(x.v!==1||!Number.isSafeInteger(x.balance)||x.balance<0||x.balance>10000||!Array.isArray(x.history)||x.history.length>100||!Array.isArray(x.appliedPurchases)||!['paid','trial'].includes(x.policy))return initial();
    const route=['discover','photo','review','edit','task','result','garage'].includes(x.route)?x.route:'discover';
    for(const v of x.history){if(typeof v.id!=='string'||typeof v.jobId!=='string'||!COLORS[v.recipe?.body]||!COLORS[v.recipe?.wheel])return initial();}
    if(x.job&&!['queued','processing','uncertain','succeeded','failed','cancelled'].includes(x.job.phase))return initial();
    return {...initial(x.policy),...x,route,sheet:null};
  }catch{return initial();}
}
