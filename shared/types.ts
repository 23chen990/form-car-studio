export type StyleId =
  | "clean"
  | "sport"
  | "dark"
  | "heritage"
  | "track"
  | "rally"
  | "touring"
  | "color";
export type TaskStatus =
  | "queued"
  | "processing"
  | "uncertain"
  | "cancelled"
  | "succeeded"
  | "failed";
export interface Target {
  bodyColor: string;
  wheelColor: string;
}
export interface Draft {
  styleId: StyleId;
  baseVersionId: string | null;
  target: Target;
  intent: "explore" | "refine";
  updatedAt: string;
}
export interface Version {
  id: string;
  projectId: string;
  parentVersionId: string | null;
  name: string;
  imageUrl: string;
  styleId: StyleId;
  target: Target;
  verifiedTarget?: Target;
  favorite: boolean;
  createdAt: string;
  demo: boolean;
}
export interface Project {
  id: string;
  name: string;
  source: "sample" | "upload";
  originalUrl: string;
  draft: Draft | null;
  versions: Version[];
  createdAt: string;
}
export interface GenerationTask {
  id: string;
  projectId: string;
  status: TaskStatus;
  intent: "explore" | "refine";
  styleId: StyleId;
  baseVersionId: string | null;
  target: Target;
  versionId: string | null;
  error: string | null;
  cost: number;
  createdAt: string;
  retryOfTaskId: string | null;
}
export interface LedgerEntry {
  id: string;
  taskId: string | null;
  type: "grant" | "reserve" | "settle" | "release";
  amount: number;
  createdAt: string;
}
export interface AppState {
  mode: "demo" | "live";
  credits: number;
  reservedCredits: number;
  projects: Project[];
  tasks: GenerationTask[];
  ledger: LedgerEntry[];
  savedStyles: StyleId[];
  generationEnabled: boolean;
}
export interface GenerateInput {
  projectId: string;
  styleId: StyleId;
  intent: "explore" | "refine";
  baseVersionId: string | null;
  target: Target;
  idempotencyKey: string;
  consent: boolean;
  retryOfTaskId?: string | null;
}
export interface Report {
  id: string;
  taskId: string;
  reason: string;
  createdAt: string;
}
export type EditField = "bodyColor" | "wheelColor";
export interface StyleDefinition {
  id: StyleId;
  name: string;
  shortName: string;
  description: string;
  category: "Subtle" | "Sporty" | "Expressive";
  details: string[];
  imageUrl: string;
  prompt: string;
  sampleBodyColor: string;
  sampleWheelColor: string;
}
