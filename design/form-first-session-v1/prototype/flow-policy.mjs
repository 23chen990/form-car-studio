/** Proposed UI decision selector. Reads adapter snapshots, performs no I/O and grants no authority. */
const action=(kind,label,reason=null)=>({kind,label,reason,autoSubmit:false});
export function creationAction(s){
  if(!s||typeof s!=='object')return action('unavailable','Try again','State is unavailable.');
  if(s.activeTaskId)return action('resume','View current request');
  if(!s.sourceSelected)return action('choose_photo','Choose a photo');
  if(s.online!==true)return action('reconnect','Reconnect to continue','Your selections are kept.');
  if(s.capabilityReady!==true)return action('unavailable','Creation is not available','Browse examples. No photo will be uploaded.');
  if(s.localFileValid!==true)return action('replace_photo','Choose another photo','This file cannot be used for this edit.');
  if(s.signedIn!==true)return action('sign_in','Continue with Apple');
  if(s.consentCurrent!==true)return action('consent','Review photo use');
  if(s.ownedAssetReady!==true)return action('prepare_photo','Prepare this photo');
  if(s.quoteCurrent!==true)return action('refresh_quote','Review your request');
  if(!Number.isSafeInteger(s.quoteCost)||s.quoteCost!==1)return action('unavailable','Check request details','Unsupported cost for the first release.');
  if(!Number.isSafeInteger(s.availableCredits)||s.availableCredits<0)return action('sync_balance','Sync balance');
  if(s.availableCredits<s.quoteCost){
    if(s.trialApproved===true&&s.trialEligibility==='eligible')return action('claim_trial','Use 1 trial credit');
    if(s.catalogReady!==true)return action('products_unavailable','Credit packs unavailable','Keep browsing; your choices are kept.');
    return action('purchase','See credit packs');
  }
  return action('confirm','Create 1 look - 1 credit');
}
export function purchaseReturn(outcome){
  if(outcome==='credited'||outcome==='already_credited')return {destination:'review',refreshQuote:true,refreshBalance:true,autoSubmit:false};
  if(outcome==='pending'||outcome==='verification_unknown')return {destination:'purchase_status',refreshQuote:false,refreshBalance:true,autoSubmit:false};
  return {destination:'review',refreshQuote:false,refreshBalance:true,autoSubmit:false};
}
export function taskPresentation(t){
  if(!t)return {title:'Request unavailable',detail:'Reconnect to check your request.',canCancel:false};
  const returned=t.creditReleaseConfirmed===true?'Your credit was returned.':'We are checking your credit balance.';
  const mapping={queued:['Waiting to start','You can leave and return to this same request.'],processing:['Creating your look','You can browse or leave. We will not submit another request.'],uncertain:['Checking an interrupted request','Do not pay or submit again. Your request is being checked.'],succeeded:['Your look is ready','Open the saved result.'],failed:['This look could not be completed',returned],cancelled:['Request cancelled',returned]};
  const pair=mapping[t.status]||['Checking your request','The current status is unavailable.'];
  return {title:pair[0],detail:pair[1],canCancel:t.status==='queued'};
}
