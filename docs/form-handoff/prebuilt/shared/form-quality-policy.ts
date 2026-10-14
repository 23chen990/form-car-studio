/** Pure recommendation policy. NOT a quality detector, authorizer, or money writer. */
export type Problem = 'identity_changed' | 'target_not_applied' | 'unwanted_structure' | 'image_artifacts';
export type Decision = { deliver: boolean; creditAction: 'settle' | 'release'; quality: 'unassessed' | 'accepted' | 'rejected'; reason: string };
export interface PixelDigest { normalizerVersion: string; sha256: string; width: number; height: number }
export interface OutputCheck {requestedEdits: number;decode: 'valid' | 'invalid';sourcePixels?: PixelDigest;outputPixels?: PixelDigest;assessment?: { status: 'not_assessed' | 'accepted' | 'rejected'; issue?: Problem };}
const issues: readonly Problem[] = ['identity_changed','target_not_applied','unwanted_structure','image_artifacts'];
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function demand(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function exact(v: Record<string, unknown>, allowed: string[]) { demand(Reflect.ownKeys(v).every(k => typeof k === 'string' && allowed.includes(k)), 'Unknown field'); }
function digest(v: unknown): PixelDigest {
 demand(object(v), 'Pixel digest object required'); exact(v,['normalizerVersion','sha256','width','height']);
 demand(typeof v.normalizerVersion === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(v.normalizerVersion), 'Normalizer version required');
 demand(typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sha256), 'Normalized pixel SHA256 required');
 demand(Number.isSafeInteger(v.width) && Number(v.width)>0 && Number(v.width)<=40000, 'Invalid width');
 demand(Number.isSafeInteger(v.height) && Number(v.height)>0 && Number(v.height)<=40000, 'Invalid height');
 return v as unknown as PixelDigest;
}
/** Hash canonical oriented, color-normalized RGBA pixels, NOT encoded PNG/JPEG bytes. */
export function sameNormalizedPixels(a: PixelDigest, b: PixelDigest): boolean {const x=digest(a),y=digest(b);return x.normalizerVersion===y.normalizerVersion && x.width===y.width && x.height===y.height && x.sha256===y.sha256;}
/** Server must construct assessment from its approved review record, never client claims. */
export function classifyOutput(input: OutputCheck): Decision {
 demand(object(input),'Output check object required');exact(input,['requestedEdits','decode','sourcePixels','outputPixels','assessment']);
 demand(Number.isSafeInteger(input.requestedEdits) && input.requestedEdits>0,'At least one resolved edit required');
 demand(input.decode==='valid'||input.decode==='invalid','Invalid decode result');
 if(input.sourcePixels!==undefined) digest(input.sourcePixels);if(input.outputPixels!==undefined) digest(input.outputPixels);
 if(input.assessment!==undefined) {const a=input.assessment;demand(object(a),'Assessment object required');exact(a,['status','issue']);demand(['not_assessed','accepted','rejected'].includes(a.status),'Invalid assessment status');if(a.status==='rejected') demand(issues.includes(a.issue as Problem),'A supported issue is required');else demand(a.issue===undefined,'Issue contradicts assessment status');}
 if(input.decode==='invalid') return {deliver:false,creditAction:'release',quality:'rejected',reason:'OUTPUT_INVALID'};
 if(input.sourcePixels && input.outputPixels && sameNormalizedPixels(input.sourcePixels,input.outputPixels))return {deliver:false,creditAction:'release',quality:'rejected',reason:'OUTPUT_UNCHANGED'};
 if(input.assessment?.status==='rejected')return {deliver:false,creditAction:'release',quality:'rejected',reason:input.assessment.issue!.toUpperCase()};
 return {deliver:true,creditAction:'settle',quality:input.assessment?.status==='accepted'?'accepted':'unassessed',reason:'OUTPUT_DELIVERABLE'};
}
export interface CompensationInput {rootTaskId:string;taskStatus:'succeeded'|'failed'|'cancelled'|'processing';creditCost:number;rootAlreadyCompensated:boolean;review:'approved'|'pending'|'rejected';policyVersion:string}
/** Pure plan only: transaction + UNIQUE(root_task_id) are mandatory during integration. */
export function planCompensation(v:CompensationInput):{grantUnits:number;benefitKey:string;eventKey:string;reason:string}{
 demand(object(v),'Compensation object required');exact(v,['rootTaskId','taskStatus','creditCost','rootAlreadyCompensated','review','policyVersion']);
 demand(typeof v.rootTaskId==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v.rootTaskId),'Invalid root task');
 demand(typeof v.policyVersion==='string' && /^[a-zA-Z0-9._-]{1,80}$/.test(v.policyVersion),'Invalid policy version');
 demand(['succeeded','failed','cancelled','processing'].includes(v.taskStatus),'Invalid task status');demand(['approved','pending','rejected'].includes(v.review),'Invalid review');
 demand(Number.isSafeInteger(v.creditCost) && v.creditCost>0,'Invalid frozen task cost');demand(typeof v.rootAlreadyCompensated==='boolean','Invalid duplicate state');
 const benefitKey=`quality_compensation:${v.rootTaskId}`,eventKey=`${benefitKey}:${v.policyVersion}`;
 const grant=v.taskStatus==='succeeded' && v.review==='approved' && !v.rootAlreadyCompensated;
 return {grantUnits:grant?v.creditCost:0,benefitKey,eventKey,reason:grant?'APPROVED_COMPENSATION':'NO_NEW_COMPENSATION'};
}
