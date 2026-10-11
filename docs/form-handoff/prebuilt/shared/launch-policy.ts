/** Fail-closed local checks, not legal advice and not App Store authorization. */
import {demand,exact,record} from './edit-plan.js';
export const RECOMMENDED_MARKETS=['US'] as const;
export const EXPANSION_CANDIDATES=['AU','GB','NZ'] as const;
export interface TrialPolicy {enabled:boolean;units:number;budgetApproved:boolean;stableAccount:boolean;claimedBefore:boolean;reservedExposureMicros:number;spentMicros:number;newMaxCostMicros:number;budgetMicros:number}
export function canGrantTrial(v:TrialPolicy):{allowed:boolean;reason:string}{
 demand(record(v),'INVALID_TRIAL_POLICY');exact(v,['enabled','units','budgetApproved','stableAccount','claimedBefore','reservedExposureMicros','spentMicros','newMaxCostMicros','budgetMicros']);
 for(const key of ['enabled','budgetApproved','stableAccount','claimedBefore'] as const)demand(typeof v[key]==='boolean','INVALID_BOOLEAN');
 for(const key of ['units','reservedExposureMicros','spentMicros','newMaxCostMicros','budgetMicros'] as const)demand(Number.isSafeInteger(v[key])&&v[key]>=0,'INVALID_COST_OR_UNITS');
 if(!v.enabled)return {allowed:false,reason:'TRIAL_DISABLED'};
 if(!v.budgetApproved||v.units<1||v.newMaxCostMicros<1||v.budgetMicros<1)return {allowed:false,reason:'APPROVAL_OR_COST_MISSING'};
 if(!v.stableAccount)return {allowed:false,reason:'STABLE_ACCOUNT_REQUIRED'};
 if(v.claimedBefore)return {allowed:false,reason:'ALREADY_CLAIMED'};
 const sum=v.spentMicros+v.reservedExposureMicros+v.newMaxCostMicros;
 if(!Number.isSafeInteger(sum)||sum>v.budgetMicros)return {allowed:false,reason:'TRIAL_BUDGET_EXHAUSTED'};
 return {allowed:true,reason:'ELIGIBLE_PENDING_ATOMIC_RESERVATION'};
}
/** ISO alpha-3 from StoreKit is mapped explicitly; language/IP must never be passed here. */
export function marketFromStorefront(v:unknown):string|null {if(typeof v!=='string')return null;const m:Record<string,string>={USA:'US',AUS:'AU',GBR:'GB',NZL:'NZ',CAN:'CA'};return Object.hasOwn(m,v)?m[v]:null;}
