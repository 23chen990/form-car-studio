/** Pure V2 state decisions. DB compare-and-swap, worker leases and cost accounting are separate. */
import {ContractError} from './edit-plan.js';
export type Status='queued'|'processing'|'uncertain'|'succeeded'|'failed'|'cancelled';
export type Event='start'|'deliver'|'technical_failure'|'restart'|'recovery_expired'|'cancel'|'leave';
export interface Transition {status:Status;credits:'none'|'settle'|'release';upstream:'none'|'start_once'|'no_auto_retry';}
const statuses:readonly string[]=['queued','processing','uncertain','succeeded','failed','cancelled'];
const events:readonly string[]=['start','deliver','technical_failure','restart','recovery_expired','cancel','leave'];
export function transition(status:Status,event:Event):Transition{
 if(!statuses.includes(status)||!events.includes(event))throw new ContractError('INVALID_STATE_EVENT');
 const unchanged:Transition={status,credits:'none',upstream:'none'};
 if(event==='leave')return unchanged;
 if(['succeeded','failed','cancelled'].includes(status))return unchanged;
 if(event==='restart')return status==='processing'?{status:'uncertain',credits:'none',upstream:'no_auto_retry'}:unchanged;
 if(status==='queued'&&event==='start')return {status:'processing',credits:'none',upstream:'start_once'};
 if(status==='queued'&&event==='cancel')return {status:'cancelled',credits:'release',upstream:'none'};
 if(event==='cancel')throw new ContractError('ALREADY_SUBMITTED_CANNOT_CANCEL');
 if(status==='processing'&&event==='deliver')return {status:'succeeded',credits:'settle',upstream:'none'};
 if(event==='technical_failure')return {status:'failed',credits:'release',upstream:'none'};
 if(status==='uncertain'&&event==='recovery_expired')return {status:'failed',credits:'release',upstream:'no_auto_retry'};
 throw new ContractError('ILLEGAL_TRANSITION');
}
