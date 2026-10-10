import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/lib/api.js";

test("failed requests expose the server message instead of silently succeeding", async () => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ error: "Your photo needs a live image provider." }),
      { status: 422 },
    );
  try {
    await assert.rejects(
      api.createProject({ source: "sample" }),
      /Your photo needs a live image provider/,
    );
  } finally {
    globalThis.fetch = fetchBefore;
  }
});

test("generation sends exactly the confirmation key and request intent", async () => {
  const fetchBefore = globalThis.fetch;
  const body = {
    projectId: "p1",
    styleId: "clean" as const,
    intent: "explore" as const,
    baseVersionId: null,
    target: { bodyColor: "silver", wheelColor: "silver" },
    idempotencyKey: "one-confirmation",
    consent: true,
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/tasks");
    assert.deepEqual(JSON.parse(options!.body as string), body);
    assert.equal(options!.credentials, "same-origin");
    return new Response(JSON.stringify({ id: "task1" }));
  };
  try {
    assert.equal((await api.generate(body)).id, "task1");
  } finally {
    globalThis.fetch = fetchBefore;
  }
});
