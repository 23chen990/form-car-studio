/** Reference reducer for trusted server events, NOT an HTTP wallet or receipt verifier. */
import {canonicalJson,demand,exact,record} from './edit-plan.js';
export type Bucket='purchased'|'promotional';
export interface Allocation {purchased:number;promotional:number;status:'reserved'|'settled'|'released'}
export interface Wallet {available:Record<Bucket,number>;reservations:Record<string,Allocation>;events:Record<string,string>}
export type CreditEvent={key:string;kind:'grant';bucket:Bucket;units:number}|{key:string;kind:'reserve';taskId:string;units:number}|{key:string;kind:'settle'|'release';taskId:string};
const token=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,199}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
const uint=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const positive=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
const add=(a:number,b:number)=>{const n=a+b;demand(uint(n),'UNSAFE_CREDIT_TOTAL');return n;};
export function emptyWallet():Wallet{return {available:{purchased:0,promotional:0},reservations:Object.create(null),events:Object.create(null)};}
export function applyCreditEvent(state:Wallet,raw:unknown):Wallet{
 demand(record(state)&&record(state.available)&&record(state.reservations)&&record(state.events),'INVALID_WALLET');
 exact(state,['available','reservations','events']);exact(state.available,['purchased','promotional']);
 demand(uint(state.available.purchased)&&uint(state.available.promotional),'INVALID_BALANCE');add(state.available.purchased,state.available.promotional);
 for(const [k,v] of Object.entries(state.reservations)){demand(token(k)&&record(v),'INVALID_RESERVATION');exact(v,['purchased','promotional','status']);demand(uint(v.purchased)&&uint(v.promotional)&&['reserved','settled','released'].includes(v.status),'INVALID_RESERVATION');add(v.purchased,v.promotional);}
 for(const [k,v] of Object.entries(state.events))demand(token(k)&&typeof v==='string','INVALID_EVENT_HISTORY');
 demand(record(raw),'EVENT_REQUIRED');demand(token(raw.key),'INVALID_EVENT_KEY');demand(typeof raw.kind==='string'&&['grant','reserve','settle','release'].includes(raw.kind),'INVALID_EVENT');
 exact(raw,raw.kind==='grant'?['key','kind','bucket','units']:raw.kind==='reserve'?['key','kind','taskId','units']:['key','kind','taskId']);
 if(raw.kind==='grant')demand(typeof raw.bucket==='string'&&['purchased','promotional'].includes(raw.bucket)&&positive(raw.units),'INVALID_GRANT');
 else {demand(token(raw.taskId),'INVALID_TASK');if(raw.kind==='reserve')demand(positive(raw.units),'INVALID_RESERVE');}
 const event=raw as CreditEvent,signature=canonicalJson(event);
 if(Object.hasOwn(state.events,event.key)){demand(state.events[event.key]===signature,'EVENT_KEY_CONFLICT');return state;}
 const next:Wallet={available:{...state.available},reservations:Object.assign(Object.create(null),state.reservations),events:Object.assign(Object.create(null),state.events)};
 if(event.kind==='grant'){next.available[event.bucket]=add(next.available[event.bucket],event.units);add(next.available.purchased,next.available.promotional);}
 else if(event.kind==='reserve'){
  demand(!Object.hasOwn(next.reservations,event.taskId),'TASK_ALREADY_RESERVED');
  demand(add(next.available.purchased,next.available.promotional)>=event.units,'INSUFFICIENT_CREDITS');
  const promo=Math.min(event.units,next.available.promotional),paid=event.units-promo;
  next.available.promotional-=promo;next.available.purchased-=paid;
  next.reservations[event.taskId]={purchased:paid,promotional:promo,status:'reserved'};
 } else {
  const reservation=next.reservations[event.taskId];demand(reservation,'RESERVATION_NOT_FOUND');
  if(reservation.status!=='reserved'){demand(reservation.status===(event.kind==='settle'?'settled':'released'),'RESERVATION_TERMINAL_CONFLICT');next.events[event.key]=signature;return next;}
  if(event.kind==='release'){next.available.purchased=add(next.available.purchased,reservation.purchased);next.available.promotional=add(next.available.promotional,reservation.promotional);}
  next.reservations[event.taskId]={...reservation,status:event.kind==='settle'?'settled':'released'};
 }
 add(next.available.purchased,next.available.promotional);next.events[event.key]=signature;return next;
}
