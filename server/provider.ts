import type { StyleId } from "../shared/types";
import { STYLE_BY_ID, colorName } from "../shared/catalog";

export interface GenerationRequest {
  image: Buffer;
  imageMimeType: "image/png";
  styleId: StyleId;
  intent: "explore" | "refine";
  target: { bodyColor: string; wheelColor: string };
  projectName: string;
  signal: AbortSignal;
}

export type GenerationProvider = (input: GenerationRequest) => Promise<Buffer>;

interface LiveProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function imageEditsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/images/edits`;
}

function buildPrompt(input: GenerationRequest): string {
  return [
    `Edit the existing car image for the project "${input.projectName}".`,
    "Preserve the car's identity, body geometry, proportions, silhouette, perspective, camera angle, composition, windows, lighting, shadows, and background. Keep the entire visible vehicle in frame.",
    input.intent === "explore"
      ? `${STYLE_BY_ID[input.styleId].prompt} This is a ${input.styleId} explore edit of the original photo.`
      : `This is a ${input.styleId} refine edit of an existing result. Change only the selected colors. Keep all other styling, wheel structure and stance unchanged.`,
    input.target.bodyColor === "keep"
      ? "Preserve the existing body paint color exactly."
      : `Set the body paint to ${colorName(input.target.bodyColor)}.`,
    input.target.wheelColor === "keep"
      ? "Preserve the existing wheel color exactly."
      : `Set the wheel finish color to ${colorName(input.target.wheelColor)}.`,
    "Do not add or remove objects, alter the vehicle geometry, or change the background.",
  ].join(" ");
}

function decodeImage(value: unknown): Buffer {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      "Image generation response did not include b64_json image data.",
    );
  }

  const base64 = value.replace(/\s+/g, "");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  ) {
    throw new Error(
      "Image generation response contained invalid b64_json image data.",
    );
  }

  const image = Buffer.from(base64, "base64");
  if (image.length === 0) {
    throw new Error(
      "Image generation response contained empty b64_json image data.",
    );
  }
  return image;
}

function responseB64Json(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || !("data" in payload))
    return undefined;
  const data = payload.data;
  if (
    !Array.isArray(data) ||
    data.length === 0 ||
    !data[0] ||
    typeof data[0] !== "object"
  )
    return undefined;
  return "b64_json" in data[0] ? data[0].b64_json : undefined;
}

export function createLiveProvider(
  options: LiveProviderOptions,
): GenerationProvider {
  if (!options.apiKey) throw new Error("Live provider requires an API key.");
  if (!options.model)
    throw new Error("Live provider requires an explicitly configured model.");

  const request = options.fetchFn ?? globalThis.fetch;
  if (!request) throw new Error("Live provider requires fetch support.");
  const endpoint = imageEditsUrl(options.baseUrl ?? DEFAULT_BASE_URL);

  return async (input) => {
    const form = new FormData();
    form.set("model", options.model);
    form.set(
      "image",
      new Blob([new Uint8Array(input.image)], { type: input.imageMimeType }),
      "car.png",
    );
    form.set("prompt", buildPrompt(input));

    const response = await request(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}` },
      body: form,
      signal: input.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Image generation upstream failed with status ${response.status}.`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (input.signal.aborted) throw error;
      throw new Error("Image generation returned invalid JSON.");
    }

    return decodeImage(responseB64Json(payload));
  };
}
