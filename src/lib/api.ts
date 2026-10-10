import type {
  AppState,
  Draft,
  GenerateInput,
  GenerationTask,
  Project,
  Report,
  StyleId,
  Version,
} from "../../shared/types";

type JsonValue = unknown;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const type = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  let payload: JsonValue = raw;
  if (type.includes("json") || /^\s*[\[{]/.test(raw)) {
    try {
      payload = JSON.parse(raw) as JsonValue;
    } catch {
      /* preserve a non-JSON error body */
    }
  }
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : typeof payload === "string" && payload
          ? payload
          : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

export const api = {
  state: (): Promise<AppState> => request("/api/state"),
  createProject: (input: {
    name?: string;
    source: "sample" | "upload";
    imageData?: string;
  }): Promise<Project> => request("/api/projects", json(input)),
  updateProject: (
    id: string,
    patch: { name?: string; draft?: Draft | null },
  ): Promise<Project> =>
    request(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteProject: (id: string): Promise<{ ok: true }> =>
    request(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
  updateVersion: (
    id: string,
    patch: { favorite?: boolean; name?: string },
  ): Promise<Version> =>
    request(`/api/versions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  generate: (input: GenerateInput): Promise<GenerationTask> =>
    request("/api/tasks", json(input)),
  task: (id: string): Promise<GenerationTask> =>
    request(`/api/tasks/${encodeURIComponent(id)}`),
  cancel: (id: string): Promise<GenerationTask> =>
    request(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  report: (id: string, reason: string): Promise<Report> =>
    request(`/api/tasks/${encodeURIComponent(id)}/report`, json({ reason })),
  saveStyle: (
    styleId: StyleId,
    saved: boolean,
  ): Promise<{ savedStyles: StyleId[] }> =>
    request(`/api/styles/${encodeURIComponent(styleId)}`, {
      method: "PATCH",
      body: JSON.stringify({ saved }),
    }),
};

export { request as apiRequest };
