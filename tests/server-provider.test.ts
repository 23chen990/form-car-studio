import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLiveProvider,
  type GenerationRequest,
} from "../server/provider.js";

const sourceImage = Buffer.from("source-car");

function requestFor(
  overrides: Partial<GenerationRequest> = {},
): GenerationRequest {
  return {
    image: sourceImage,
    imageMimeType: "image/png",
    styleId: "sport",
    intent: "refine",
    target: { bodyColor: "ruby red", wheelColor: "graphite" },
    projectName: "Weekend GT",
    signal: new AbortController().signal,
    ...overrides,
  };
}

test("posts a PNG edit multipart request and decodes the b64_json image", async () => {
  const editedImage = Buffer.from("edited-car");
  let requestedUrl: string | undefined;
  let requestInit: RequestInit | undefined;
  const fetchFn: typeof fetch = async (url, init) => {
    requestedUrl = String(url);
    requestInit = init;
    return new Response(
      JSON.stringify({ data: [{ b64_json: editedImage.toString("base64") }] }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const generate = createLiveProvider({
    apiKey: "test-secret",
    model: "configured-image-model",
    fetchFn,
  });
  const result = await generate(requestFor());

  assert.equal(requestedUrl, "https://api.openai.com/v1/images/edits");
  assert.equal(requestInit?.method, "POST");
  assert.equal(
    requestInit?.headers &&
      new Headers(requestInit.headers).get("authorization"),
    "Bearer test-secret",
  );
  const contentType =
    requestInit?.headers &&
    new Headers(requestInit.headers).get("content-type");
  assert.equal(contentType, null);

  const form = await new Response(requestInit?.body).formData();
  assert.equal(form.get("model"), "configured-image-model");
  const uploaded = form.get("image");
  assert.ok(uploaded instanceof Blob);
  assert.equal(uploaded.type, "image/png");
  assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), sourceImage);

  const prompt = form.get("prompt");
  assert.ok(typeof prompt === "string");
  assert.match(prompt, /preserv(?:e|ing).*geometry/i);
  assert.match(prompt, /background/i);
  assert.match(prompt, /ruby red/i);
  assert.match(prompt, /graphite/i);
  assert.match(prompt, /sport/i);
  assert.match(prompt, /refine/i);
  assert.match(prompt, /Weekend GT/i);
  assert.deepEqual(result, editedImage);
});

test("Keep current refinement preserves untouched paint and explores an explicit style direction", async () => {
  const prompts: string[] = [];
  const provider = createLiveProvider({
    apiKey: "test",
    model: "image-model",
    fetchFn: async (_url, init) => {
      const form = await new Response(init?.body).formData();
      prompts.push(String(form.get("prompt")));
      return new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("image").toString("base64") }],
        }),
      );
    },
  });
  await provider(
    requestFor({ target: { bodyColor: "keep", wheelColor: "silver" } }),
  );
  assert.match(prompts[0], /preserve.*body paint/i);
  assert.doesNotMatch(prompts[0], /paint color to keep/i);
  await provider(
    requestFor({
      styleId: "heritage",
      intent: "explore",
      target: { bodyColor: "green", wheelColor: "silver" },
    }),
  );
  assert.match(prompts[1], /modern.classic|heritage/i);
});

test("passes the caller AbortSignal through to the single upstream request", async () => {
  const controller = new AbortController();
  let calls = 0;
  let signalSeen: AbortSignal | undefined;
  const fetchFn: typeof fetch = async (_url, init) => {
    calls += 1;
    signalSeen = init?.signal as AbortSignal;
    throw new DOMException("The operation was aborted.", "AbortError");
  };

  const generate = createLiveProvider({
    apiKey: "test-secret",
    model: "configured-image-model",
    fetchFn,
  });
  await assert.rejects(
    generate(requestFor({ signal: controller.signal })),
    /aborted/i,
  );
  assert.equal(signalSeen, controller.signal);
  assert.equal(calls, 1);
});

test("fails once on an upstream error without exposing the API key or retrying", async () => {
  const apiKey = "test-secret-that-must-stay-private";
  let calls = 0;
  const fetchFn: typeof fetch = async () => {
    calls += 1;
    return new Response(`upstream failure; secret=${apiKey}`, {
      status: 503,
      statusText: "Service Unavailable",
    });
  };

  const generate = createLiveProvider({
    apiKey,
    model: "configured-image-model",
    fetchFn,
  });
  await assert.rejects(
    generate(requestFor()),
    (error: unknown) =>
      error instanceof Error &&
      /503/.test(error.message) &&
      !error.message.includes(apiKey),
  );
  assert.equal(calls, 1);
});

test("rejects a URL-only image response instead of fetching arbitrary remote content", async () => {
  let calls = 0;
  const fetchFn: typeof fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ data: [{ url: "https://example.test/generated.png" }] }),
      { status: 200 },
    );
  };

  const generate = createLiveProvider({
    apiKey: "test-secret",
    model: "configured-image-model",
    fetchFn,
  });
  await assert.rejects(generate(requestFor()), /b64_json/i);
  assert.equal(calls, 1);
});
