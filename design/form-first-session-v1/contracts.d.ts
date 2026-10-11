/** UI-only adapter proposal; no credentials, ownership assertions or payments are trusted from the view. */
export type TaskPhase = 'queued'|'processing'|'uncertain'|'succeeded'|'failed'|'cancelled';
export type Provenance = 'illustrated'|'licensed_example'|'user_original'|'user_result';
export type SourceRef = {projectId:string; assetId:string; versionId:string|null; contentDigest:string; provenance:Provenance};
export type DraftIntent = Readonly<{intentId:string; revision:number; source:SourceRef; operation:'explore'|'detail'; styleId:string|null; edits:Readonly<Record<string,unknown>>}>;
export type Quote = Readonly<{id:string; intentId:string; sourceDigest:string; expiresAt:string; userCostUnits:1; outputCount:1; capabilityVersion:string; consentPolicyVersion:string; processorId:string}>;
export type CreationSnapshot = Readonly<{activeTaskId?:string|null;sourceSelected:boolean;online:boolean;capabilityReady:boolean;localFileValid:boolean;signedIn:boolean;consentCurrent:boolean;ownedAssetReady:boolean;quoteCurrent:boolean;quoteCost:number|null;availableCredits:number|null;trialApproved:boolean;trialEligibility:'unknown'|'eligible'|'ineligible';catalogReady:boolean}>;
export type TaskView = Readonly<{id:string;submissionId:string;source:SourceRef;status:TaskPhase;resultVersionId:string|null;creditReleaseConfirmed:boolean;createdAt:string;updatedAt:string;errorCode:string|null}>;
export type CatalogProduct = Readonly<{productId:string;units:5|15;displayPrice:string;storefront:string;approved:boolean}>;
export type PurchaseOutcome = 'credited'|'already_credited'|'pending'|'verification_unknown'|'cancelled'|'failed';
export interface JourneyAdapter {
  readonly mode:'demo'|'live';
  snapshot(): Promise<CreationSnapshot>;
  signIn(): Promise<'signed_in'|'cancelled'|'failed'>;
  /** Actual UI must disclose these values; unknown policy keeps live transfer off. */
  getProcessingPolicy(): Promise<{processorId:string;processorName:string;policyVersion:string;privacyUrl:string}|null>;
  recordConsent(policyVersion:string,purposes:readonly string[]):Promise<{consentRecordId:string}>;
  preparePhoto(blob:Blob,consentRecordId:string):Promise<SourceRef>;
  quote(intent:DraftIntent):Promise<Quote>;
  submit(quoteId:string,submissionId:string,consentRecordId:string):Promise<TaskView>;
  getSubmission(submissionId:string):Promise<TaskView|null>;
  getTask(taskId:string):Promise<TaskView>;
  cancelQueued(taskId:string):Promise<TaskView>;
  catalog():Promise<readonly CatalogProduct[]>;
  purchase(productId:string):Promise<PurchaseOutcome>;
  syncBalance():Promise<number|null>;
  report(taskId:string,category:string,description:string):Promise<{caseId:string}>;
  /** Save/share outcomes are not interchangeable; cancellation is not completion. */
  exportAsset(assetId:string,kind:'image'|'comparison'|'portrait'):Promise<'saved'|'share_sheet_opened'|'cancelled'|'failed'>;
}
