import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Server } from "node:http";

type Options = Record<string, unknown>;

async function start(options: Options = {}, directory?: string) {
  const dataDir = directory ?? (await mkdtemp(join(tmpdir(), "form-server-")));
  let module: any;
  try {
    module = await import("../server/app.js");
  } catch {
    assert.fail(
      "The backend createApp factory must exist before API behavior can work.",
    );
  }
  const instance = module.createApp({
    dataDir,
    queueDelayMs: 5,
    uncertainTimeoutMs: 60,
    ...options,
  });
  const server: Server = await new Promise((resolve) => {
    const server = instance.app.listen(0, "127.0.0.1", () => resolve(server));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  let cookie = "";
  const request = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", cookie);
    if (init.body && !headers.has("content-type"))
      headers.set("content-type", "application/json");
    const response = await fetch(base + path, { ...init, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return response;
  };
  return {
    dataDir,
    base,
    request,
    setCookie(value: string) {
      cookie = value;
    },
    get cookie() {
      return cookie;
    },
    async close(clean = true) {
      await instance.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (clean) await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function json(response: Response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

async function sample(client: Awaited<ReturnType<typeof start>>) {
  return json(
    await client.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ source: "sample", name: "Test car" }),
    }),
    201,
  );
}

function input(
  projectId: string,
  key = "one-confirmation",
): import("../shared/types").GenerateInput {
  return {
    projectId,
    styleId: "clean",
    intent: "explore",
    baseVersionId: null,
    target: { bodyColor: "blue", wheelColor: "bronze" },
    idempotencyKey: key,
    consent: true,
  };
}

async function generate(
  client: Awaited<ReturnType<typeof start>>,
  body: ReturnType<typeof input>,
) {
  return client.request("/api/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function terminal(
  client: Awaited<ReturnType<typeof start>>,
  taskId: string,
) {
  for (let attempts = 0; attempts < 100; attempts++) {
    const task = await json(await client.request(`/api/tasks/${taskId}`));
    if (task.status === "succeeded" || task.status === "failed") return task;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("The persisted queue did not finish the task.");
}

test("session state grants demo credits once and keeps every resource private", async () => {
  const client = await start();
  try {
    const response = await client.request("/api/state");
    const state = await json(response);
    assert.equal(state.mode, "demo");
    assert.equal(state.credits, 12);
    assert.equal(state.reservedCredits, 0);
    assert.match(response.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(response.headers.get("set-cookie")!, /SameSite=Strict/);
    assert.equal(
      (await json(await client.request("/api/state"))).ledger.length,
      1,
    );
    const project = await sample(client);
    const ownerCookie = client.cookie;
    client.setCookie("");
    assert.equal(
      (await json(await client.request("/api/state"))).projects.length,
      0,
    );
    await json(
      await client.request(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Stolen" }),
      }),
      404,
    );
    assert.equal((await client.request(project.originalUrl)).status, 404);
    client.setCookie(ownerCookie);
    const image = await client.request(project.originalUrl);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.match(image.headers.get("cache-control")!, /no-store/);
  } finally {
    await client.close();
  }
});

test("one confirmation reserves and settles exactly once, even under concurrent duplicates", async () => {
  const client = await start({ queueDelayMs: 40 });
  try {
    const project = await sample(client);
    const body = input(project.id);
    const responses = await Promise.all([
      generate(client, body),
      generate(client, body),
    ]);
    const tasks = await Promise.all(
      responses.map(async (response) => {
        assert.ok(response.status === 200 || response.status === 202);
        return response.json();
      }),
    );
    assert.equal(tasks[0].id, tasks[1].id);
    let state = await json(await client.request("/api/state"));
    assert.equal(state.credits, 11);
    assert.equal(state.reservedCredits, 1);
    await json(
      await generate(client, {
        ...body,
        target: { bodyColor: "red", wheelColor: "bronze" },
      }),
      409,
    );
    await json(
      await generate(client, { ...body, idempotencyKey: "second-active" }),
      409,
    );
    await json(
      await client.request(`/api/projects/${project.id}`, { method: "DELETE" }),
      409,
    );
    const done = await terminal(client, tasks[0].id);
    assert.equal(done.status, "succeeded");
    assert.ok(done.versionId);
    const retry = await json(await generate(client, body));
    assert.equal(retry.id, done.id);
    state = await json(await client.request("/api/state"));
    assert.equal(state.credits, 11);
    assert.equal(state.reservedCredits, 0);
    assert.equal(state.projects[0].versions.length, 1);
    assert.deepEqual(
      state.ledger
        .filter((entry: any) => entry.taskId === done.id)
        .map((entry: any) => entry.type)
        .sort(),
      ["reserve", "settle"],
    );
    const png = Buffer.from(
      await (
        await client.request(state.projects[0].versions[0].imageUrl)
      ).arrayBuffer(),
    );
    const original = Buffer.from(
      await (await client.request(project.originalUrl)).arrayBuffer(),
    );
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.notDeepEqual(png, original);
    const version = await json(
      await client.request(`/api/versions/${done.versionId}`, {
        method: "PATCH",
        body: JSON.stringify({ favorite: true, name: "My blue build" }),
      }),
    );
    assert.equal(version.favorite, true);
    assert.equal(version.name, "My blue build");
    const ledgerBefore = state.ledger.length;
    await json(
      await client.request(`/api/tasks/${done.id}/report`, {
        method: "POST",
        body: JSON.stringify({ reason: "轮毂需要更准确" }),
      }),
      201,
    );
    state = await json(await client.request("/api/state"));
    assert.equal(state.tasks.length, 1);
    assert.equal(state.ledger.length, ledgerBefore);
  } finally {
    await client.close();
  }
});

test("demo upload is decoded and stripped of metadata, then generation rejects without reserving", async () => {
  const client = await start();
  try {
    const sharp = (await import("sharp")).default;
    const photo = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#d8d8d8" },
    })
      .withMetadata()
      .jpeg()
      .toBuffer();
    const uploaded = await json(
      await client.request("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          source: "upload",
          imageData: `data:image/jpeg;base64,${photo.toString("base64")}`,
        }),
      }),
      201,
    );
    const saved = Buffer.from(
      await (await client.request(uploaded.originalUrl)).arrayBuffer(),
    );
    const metadata = await sharp(saved).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    await json(await generate(client, input(uploaded.id)), 422);
    const state = await json(await client.request("/api/state"));
    assert.equal(state.credits, 12);
    assert.equal(state.tasks.length, 0);
    assert.equal(state.ledger.length, 1);
    await json(
      await client.request("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          source: "upload",
          imageData: "data:image/png;base64,bm90IGFuIGltYWdl",
        }),
      }),
      422,
    );
    assert.equal(
      (await json(await client.request("/api/state"))).projects.length,
      1,
    );
  } finally {
    await client.close();
  }
});

test("drafts and parent versions stay owner scoped and survive restart", async () => {
  let client = await start();
  const directory = client.dataDir;
  try {
    const project = await sample(client);
    const draft = {
      styleId: "sport",
      intent: "explore",
      baseVersionId: null,
      target: { bodyColor: "green", wheelColor: "black" },
      updatedAt: new Date().toISOString(),
    };
    await json(
      await client.request(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ draft }),
      }),
    );
    const task = await json(await generate(client, input(project.id)), 202);
    const done = await terminal(client, task.id);
    const savedCookie = client.cookie;
    client.setCookie("");
    await json(
      await client.request(`/api/versions/${done.versionId}`, {
        method: "PATCH",
        body: JSON.stringify({ favorite: true }),
      }),
      404,
    );
    await json(await client.request(`/api/tasks/${done.id}`), 404);
    await json(
      await client.request(`/api/tasks/${done.id}/report`, {
        method: "POST",
        body: JSON.stringify({ reason: "Other owner" }),
      }),
      404,
    );
    client.setCookie(savedCookie);
    await client.close(false);
    client = await start({}, directory);
    client.setCookie(savedCookie);
    const state = await json(await client.request("/api/state"));
    assert.equal(state.credits, 11);
    assert.equal(state.projects[0].draft.target.bodyColor, "green");
    const refine = {
      ...input(project.id, "refine-confirmation"),
      intent: "refine" as const,
      baseVersionId: done.versionId,
    };
    const refined = await json(await generate(client, refine), 202);
    assert.equal((await terminal(client, refined.id)).status, "succeeded");
    assert.equal(
      (await json(await client.request("/api/state"))).projects[0].versions[1]
        .parentVersionId,
      done.versionId,
    );
  } finally {
    await client.close();
  }
});

test("live failure releases once and live default has no invented balance", async () => {
  let calls = 0;
  const noCredits = await start({
    mode: "live",
    provider: async () => Buffer.from("unused"),
  });
  try {
    assert.equal(
      (await json(await noCredits.request("/api/state"))).credits,
      0,
    );
  } finally {
    await noCredits.close();
  }
  const client = await start({
    mode: "live",
    initialCredits: 1,
    provider: async () => {
      calls++;
      throw new Error("Provider unavailable");
    },
  });
  try {
    const project = await sample(client);
    const body = input(project.id);
    const task = await json(await generate(client, body), 202);
    assert.equal((await terminal(client, task.id)).status, "failed");
    assert.equal((await json(await generate(client, body))).id, task.id);
    const state = await json(await client.request("/api/state"));
    assert.equal(calls, 1);
    assert.equal(state.credits, 1);
    assert.equal(state.reservedCredits, 0);
    assert.deepEqual(
      state.ledger
        .filter((entry: any) => entry.taskId === task.id)
        .map((entry: any) => entry.type)
        .sort(),
      ["release", "reserve"],
    );
  } finally {
    await client.close();
  }
});

test("explicit retries link only an owned failed task with the identical snapshot", async () => {
  let calls = 0;
  const client = await start({
    mode: "live",
    initialCredits: 2,
    provider: async () => {
      calls++;
      if (calls === 1) throw new Error("Provider unavailable");
      const sharp = (await import("sharp")).default;
      return sharp({
        create: { width: 8, height: 8, channels: 3, background: "#345678" },
      })
        .png()
        .toBuffer();
    },
  });
  try {
    const project = await sample(client);
    const firstInput = input(project.id, "first-attempt");
    const first = await json(await generate(client, firstInput), 202);
    assert.equal((await terminal(client, first.id)).status, "failed");

    const retryInput = {
      ...firstInput,
      idempotencyKey: "second-attempt",
      retryOfTaskId: first.id,
    };
    const retry = await json(await generate(client, retryInput), 202);
    assert.equal(retry.retryOfTaskId, first.id);
    assert.equal((await terminal(client, retry.id)).status, "succeeded");
    assert.equal((await json(await generate(client, retryInput))).id, retry.id);
    await json(
      await generate(client, {
        ...retryInput,
        retryOfTaskId: null,
      }),
      409,
    );

    const state = await json(await client.request("/api/state"));
    assert.equal(calls, 2);
    assert.equal(state.credits, 1);
    assert.equal(state.reservedCredits, 0);
    assert.deepEqual(
      state.tasks.map((task: any) => ({
        id: task.id,
        status: task.status,
        retryOfTaskId: task.retryOfTaskId,
      })),
      [
        { id: first.id, status: "failed", retryOfTaskId: null },
        { id: retry.id, status: "succeeded", retryOfTaskId: first.id },
      ],
    );
    assert.equal(state.projects[0].versions.length, 1);
  } finally {
    await client.close();
  }
});

test("retry links reject a changed snapshot, another owner, and non-failed sources", async () => {
  let calls = 0;
  const client = await start({
    mode: "live",
    initialCredits: 3,
    queueDelayMs: 50,
    provider: async () => {
      calls++;
      if (calls === 1) throw new Error("Provider unavailable");
      const sharp = (await import("sharp")).default;
      return sharp({
        create: { width: 8, height: 8, channels: 3, background: "#345678" },
      })
        .png()
        .toBuffer();
    },
  });
  try {
    const project = await sample(client);
    const firstInput = input(project.id, "retry-source");
    const failed = await json(await generate(client, firstInput), 202);
    assert.equal((await terminal(client, failed.id)).status, "failed");

    const retry = {
      ...firstInput,
      retryOfTaskId: failed.id,
      idempotencyKey: "changed-retry",
    };
    await json(
      await generate(client, {
        ...retry,
        target: { bodyColor: "red", wheelColor: "bronze" },
      }),
      409,
    );

    const ownerCookie = client.cookie;
    client.setCookie("");
    const otherProject = await sample(client);
    await json(
      await generate(client, { ...retry, projectId: otherProject.id }),
      404,
    );
    client.setCookie(ownerCookie);

    const successful = await json(
      await generate(client, input(project.id, "successful-source")),
      202,
    );
    assert.equal((await terminal(client, successful.id)).status, "succeeded");
    await json(
      await generate(client, {
        ...firstInput,
        idempotencyKey: "succeeded-retry",
        retryOfTaskId: successful.id,
      }),
      409,
    );
    const cancelled = await json(
      await generate(client, input(project.id, "cancelled-source")),
      202,
    );
    await json(
      await client.request(`/api/tasks/${cancelled.id}/cancel`, {
        method: "POST",
      }),
    );
    await json(
      await generate(client, {
        ...firstInput,
        idempotencyKey: "cancelled-retry",
        retryOfTaskId: cancelled.id,
      }),
      409,
    );
    const state = await json(await client.request("/api/state"));
    assert.equal(calls, 2);
    assert.equal(state.credits, 2);
    assert.equal(state.reservedCredits, 0);
    assert.equal(state.tasks.length, 3);
  } finally {
    await client.close();
  }
});

test("old persisted tasks expose a null retry link and keep legacy idempotency", async () => {
  let client = await start();
  const directory = client.dataDir;
  try {
    const project = await sample(client);
    const body = input(project.id, "legacy-confirmation");
    const task = await json(await generate(client, body), 202);
    await terminal(client, task.id);
    const savedCookie = client.cookie;
    const owner = savedCookie.slice("form_session=".length);
    await client.close(false);

    const db = new DatabaseSync(join(directory, "form.sqlite"));
    const row = db
      .prepare("SELECT state FROM sessions WHERE id=?")
      .get(owner) as { state: string };
    const state = JSON.parse(row.state) as any;
    delete state.tasks[0].retryOfTaskId;
    state.tasks[0].fingerprint = JSON.stringify(
      JSON.parse(state.tasks[0].fingerprint).slice(0, -1),
    );
    db.prepare("UPDATE sessions SET state=? WHERE id=?").run(
      JSON.stringify(state),
      owner,
    );
    db.close();

    client = await start({}, directory);
    client.setCookie(savedCookie);
    const restored = await json(await client.request("/api/state"));
    assert.equal(restored.tasks[0].retryOfTaskId, null);
    assert.equal((await json(await generate(client, body))).id, task.id);
  } finally {
    await client.close();
  }
});

test("restart resumes queued work but never blindly repeats a processing live request", async () => {
  let calls = 0;
  let client = await start({ queueDelayMs: 60_000 });
  const directory = client.dataDir;
  try {
    const project = await sample(client);
    const task = await json(await generate(client, input(project.id)), 202);
    const savedCookie = client.cookie;
    await client.close(false);
    client = await start({}, directory);
    client.setCookie(savedCookie);
    assert.equal((await terminal(client, task.id)).status, "succeeded");
    await client.close(false);
    client = await start(
      {
        mode: "live",
        initialCredits: 12,
        provider: async () => {
          calls++;
          return new Promise<Buffer>(() => {});
        },
        providerTimeoutMs: 60_000,
      },
      directory,
    );
    client.setCookie(savedCookie);
    const pending = await json(
      await generate(client, input(project.id, "live-pending")),
      202,
    );
    for (let n = 0; n < 100 && calls === 0; n++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(calls, 1);
    await client.close(false);
    client = await start(
      {
        mode: "live",
        provider: async () => {
          calls++;
          throw new Error("must not repeat");
        },
        uncertainTimeoutMs: 50,
      },
      directory,
    );
    client.setCookie(savedCookie);
    assert.equal(
      (await json(await client.request(`/api/tasks/${pending.id}`))).status,
      "uncertain",
    );
    const done = await terminal(client, pending.id);
    assert.equal(done.status, "failed");
    assert.equal(calls, 1);
    const state = await json(await client.request("/api/state"));
    assert.equal(state.credits, 11);
    assert.equal(state.reservedCredits, 0);
    assert.equal(
      state.ledger.filter(
        (entry: any) => entry.taskId === pending.id && entry.type === "release",
      ).length,
      1,
    );
    const db = new DatabaseSync(join(directory, "form.sqlite"));
    assert.equal(
      (db.prepare("SELECT count(*) AS count FROM reports").get() as any).count,
      0,
    );
    db.close();
  } finally {
    await client.close();
  }
});

test("mutations reject a hostile origin and malformed requests never charge", async () => {
  const client = await start();
  try {
    const project = await sample(client);
    await json(
      await client.request(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { origin: "https://hostile.example" },
        body: JSON.stringify({ name: "Changed" }),
      }),
      403,
    );
    await json(
      await generate(client, { ...input(project.id), consent: false }),
      400,
    );
    await json(
      await generate(client, {
        ...input(project.id),
        target: { bodyColor: "url(x)", wheelColor: "silver" },
      }),
      400,
    );
    await json(
      await generate(client, {
        ...input(project.id),
        baseVersionId: "another-project-version",
        intent: "refine",
      }),
      404,
    );
    const state = await json(await client.request("/api/state"));
    assert.equal(state.credits, 12);
    assert.equal(state.tasks.length, 0);
  } finally {
    await client.close();
  }
});

test("saved styles survive restart without a project or a generation task", async () => {
  let client = await start();
  const directory = client.dataDir;
  try {
    await json(
      await client.request("/api/styles/dark", {
        method: "PATCH",
        body: JSON.stringify({ saved: true }),
      }),
    );
    await json(
      await client.request("/api/styles/dark", {
        method: "PATCH",
        body: JSON.stringify({ saved: true }),
      }),
    );
    const cookie = client.cookie;
    await client.close(false);
    client = await start({}, directory);
    client.setCookie(cookie);
    const state = await json(await client.request("/api/state"));
    assert.deepEqual(state.savedStyles, ["dark"]);
    assert.equal(state.tasks.length, 0);
    assert.equal(state.projects.length, 0);
    assert.equal(state.credits, 12);
    await json(
      await client.request("/api/styles/dark", {
        method: "PATCH",
        body: JSON.stringify({ saved: false }),
      }),
    );
    assert.deepEqual(
      (await json(await client.request("/api/state"))).savedStyles,
      [],
    );
  } finally {
    await client.close();
  }
});

test("explicit frontend origin can mutate through the dev proxy while other local origins remain blocked", async () => {
  const client = await start({ allowedOrigins: ["http://127.0.0.1:5174"] });
  try {
    await json(
      await client.request("/api/styles/clean", {
        method: "PATCH",
        headers: { origin: "http://127.0.0.1:5174" },
        body: JSON.stringify({ saved: true }),
      }),
    );
    await json(
      await client.request("/api/styles/dark", {
        method: "PATCH",
        headers: { origin: "http://127.0.0.1:9999" },
        body: JSON.stringify({ saved: true }),
      }),
      403,
    );
    assert.deepEqual(
      (await json(await client.request("/api/state"))).savedStyles,
      ["clean"],
    );
  } finally {
    await client.close();
  }
});

test("cancelling queued work is authoritative, refunds once, and never produces a late version", async () => {
  const client = await start({ queueDelayMs: 80 });
  try {
    const project = await sample(client);
    const task = await json(await generate(client, input(project.id)), 202);
    const cancelled = await json(
      await client.request(`/api/tasks/${task.id}/cancel`, { method: "POST" }),
    );
    assert.equal(cancelled.status, "cancelled");
    await json(
      await client.request(`/api/tasks/${task.id}/cancel`, { method: "POST" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const state = await json(await client.request("/api/state"));
    assert.equal(state.credits, 12);
    assert.equal(state.reservedCredits, 0);
    assert.equal(state.projects[0].versions.length, 0);
    assert.equal(
      state.ledger.filter(
        (entry: any) => entry.taskId === task.id && entry.type === "release",
      ).length,
      1,
    );
  } finally {
    await client.close();
  }
});

test("refinement rejects empty changes and preserves untouched demo colors with the true branch parent", async () => {
  const client = await start();
  try {
    const project = await sample(client);
    const first = await json(await generate(client, input(project.id)), 202);
    const originalVersion = (await terminal(client, first.id)).versionId;
    const refine = {
      ...input(project.id, "empty-refine"),
      intent: "refine" as const,
      baseVersionId: originalVersion,
      target: { bodyColor: "keep", wheelColor: "keep" },
    };
    await json(await generate(client, refine), 400);
    const next = await json(
      await generate(client, {
        ...refine,
        idempotencyKey: "wheel-refine",
        target: { bodyColor: "keep", wheelColor: "silver" },
      }),
      202,
    );
    await terminal(client, next.id);
    const branch = await json(
      await generate(client, {
        ...refine,
        idempotencyKey: "body-branch",
        target: { bodyColor: "green", wheelColor: "keep" },
      }),
      202,
    );
    await terminal(client, branch.id);
    const versions = (await json(await client.request("/api/state")))
      .projects[0].versions;
    assert.equal(versions[1].parentVersionId, originalVersion);
    assert.deepEqual(versions[1].verifiedTarget, {
      bodyColor: "blue",
      wheelColor: "silver",
    });
    assert.equal(versions[2].parentVersionId, originalVersion);
    assert.deepEqual(versions[2].verifiedTarget, {
      bodyColor: "green",
      wheelColor: "bronze",
    });
  } finally {
    await client.close();
  }
});

test("live exploration uses the original photo and refinement uses the chosen saved version", async () => {
  const sharp = (await import("sharp")).default;
  const output = await sharp({
    create: { width: 12, height: 8, channels: 3, background: "#476c59" },
  })
    .png()
    .toBuffer();
  const requests: import("../server/provider").GenerationRequest[] = [];
  const client = await start({
    mode: "live",
    initialCredits: 2,
    provider: async (
      request: import("../server/provider").GenerationRequest,
    ) => {
      requests.push(request);
      return output;
    },
  });
  try {
    const project = await sample(client);
    const original = Buffer.from(
      await (await client.request(project.originalUrl)).arrayBuffer(),
    );
    const first = await json(await generate(client, input(project.id)), 202);
    const done = await terminal(client, first.id);
    let state = await json(await client.request("/api/state"));
    const saved = state.projects[0].versions[0];
    const base = Buffer.from(
      await (await client.request(saved.imageUrl)).arrayBuffer(),
    );
    assert.deepEqual(requests[0].image, original);
    assert.equal(requests[0].intent, "explore");
    assert.equal(saved.demo, false);
    assert.equal(saved.verifiedTarget, undefined);
    const refinement = await json(
      await generate(client, {
        ...input(project.id, "live-refinement"),
        intent: "refine",
        baseVersionId: done.versionId,
        target: { bodyColor: "keep", wheelColor: "silver" },
      }),
      202,
    );
    assert.equal((await terminal(client, refinement.id)).status, "succeeded");
    assert.deepEqual(requests[1].image, base);
    assert.equal(requests[1].intent, "refine");
    assert.deepEqual(requests[1].target, {
      bodyColor: "keep",
      wheelColor: "silver",
    });
    state = await json(await client.request("/api/state"));
    assert.equal(state.credits, 0);
    assert.equal(state.reservedCredits, 0);
    assert.equal(state.projects[0].versions[1].parentVersionId, saved.id);
  } finally {
    await client.close();
  }
});

test(
  "cancelling a processing provider call aborts it and ignores a late successful output",
  { timeout: 5_000 },
  async () => {
    const sharp = (await import("sharp")).default;
    const lateOutput = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#987643" },
    })
      .png()
      .toBuffer();
    let complete!: (bytes: Buffer) => void;
    let started!: () => void;
    let requestSignal: AbortSignal | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const client = await start({
      mode: "live",
      initialCredits: 1,
      provider: (request: import("../server/provider").GenerationRequest) => {
        requestSignal = request.signal;
        started();
        return new Promise<Buffer>((resolve) => {
          complete = resolve;
        });
      },
    });
    try {
      const project = await sample(client);
      const task = await json(await generate(client, input(project.id)), 202);
      await providerStarted;
      assert.equal(
        (await json(await client.request(`/api/tasks/${task.id}`))).status,
        "processing",
      );
      assert.equal(
        (
          await json(
            await client.request(`/api/tasks/${task.id}/cancel`, {
              method: "POST",
            }),
          )
        ).status,
        "cancelled",
      );
      assert.equal(requestSignal?.aborted, true);
      complete(lateOutput);
      await new Promise((resolve) => setTimeout(resolve, 25));
      await json(
        await client.request(`/api/tasks/${task.id}/cancel`, {
          method: "POST",
        }),
      );
      const state = await json(await client.request("/api/state"));
      assert.equal(state.tasks[0].status, "cancelled");
      assert.equal(state.projects[0].versions.length, 0);
      assert.equal(state.credits, 1);
      assert.equal(state.reservedCredits, 0);
      assert.deepEqual(
        state.ledger
          .filter((entry: any) => entry.taskId === task.id)
          .map((entry: any) => entry.type)
          .sort(),
        ["release", "reserve"],
      );
    } finally {
      complete?.(lateOutput);
      await client.close();
    }
  },
);
