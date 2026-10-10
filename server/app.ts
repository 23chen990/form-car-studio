import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import type {
  AppState,
  Draft,
  GenerationTask,
  GenerateInput,
  Project,
  Report,
  StyleId,
  Target,
  Version,
} from "../shared/types";
import { STYLE_BY_ID, styleName } from "../shared/catalog";
import type { GenerationProvider } from "./provider";
import { renderDemo } from "./demo";

interface StoredTask extends GenerationTask {
  key: string;
  fingerprint: string;
  mode: "demo" | "live";
}
interface SessionState
  extends Omit<AppState, "tasks" | "mode" | "generationEnabled"> {
  tasks: StoredTask[];
}
interface Options {
  dataDir: string;
  mode?: "demo" | "live";
  initialCredits?: number;
  provider?: GenerationProvider;
  queueDelayMs?: number;
  providerTimeoutMs?: number;
  uncertainTimeoutMs?: number;
  allowedOrigins?: string[];
}
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const active = (task: GenerationTask) =>
  ["queued", "processing", "uncertain"].includes(task.status);
const now = () => new Date().toISOString();
const id = () => randomUUID();
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
const bodyColors = new Set([
  "keep",
  "blue",
  "silver",
  "green",
  "graphite",
  "red",
]);
const wheelColors = new Set(["keep", "silver", "graphite", "bronze", "black"]);
function validateTarget(value: unknown): Target {
  if (!value || typeof value !== "object")
    return fail(400, "Choose a valid color direction.");
  const target = value as Target;
  if (!bodyColors.has(target.bodyColor) || !wheelColors.has(target.wheelColor))
    return fail(400, "That color is not available.");
  return { bodyColor: target.bodyColor, wheelColor: target.wheelColor };
}
function name(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80)
    return fail(400, "Use a name between 1 and 80 characters.");
  return value.trim();
}
async function normalizeImage(bytes: Buffer): Promise<Buffer> {
  if (bytes.length > 10 * 1024 * 1024)
    return fail(422, "Please choose an image smaller than 10 MB.");
  try {
    const image = sharp(bytes, {
      limitInputPixels: 40_000_000,
      animated: false,
    });
    const metadata = await image.metadata();
    if (
      !["png", "jpeg", "webp"].includes(metadata.format ?? "") ||
      (metadata.pages ?? 1) > 1
    )
      return fail(422, "Please choose a single JPEG, PNG or WebP image.");
    return await image
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    return fail(
      422,
      "This image could not be read. Choose a JPEG, PNG or WebP under 40 megapixels.",
    );
  }
}

export function createApp(options: Options) {
  const mode = options.mode ?? "demo";
  mkdirSync(options.dataDir, { recursive: true });
  const db = new DatabaseSync(join(options.dataDir, "form.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, owner TEXT NOT NULL, project_id TEXT NOT NULL, data BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, owner TEXT NOT NULL, task_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);`);
  let closed = false;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const controllers = new Map<string, AbortController>();
  const get = (owner: string): SessionState => {
    const row = db
      .prepare("SELECT state FROM sessions WHERE id=?")
      .get(owner) as { state: string } | undefined;
    if (!row)
      return fail(
        401,
        "Your session has expired. Reload to start a new session.",
      );
    return JSON.parse(row.state);
  };
  const save = (owner: string, state: SessionState) =>
    db
      .prepare("INSERT OR REPLACE INTO sessions VALUES (?,?)")
      .run(owner, JSON.stringify(state));
  const transaction = (fn: () => void) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const publicTask = (task: StoredTask): GenerationTask => {
    const { key: _key, fingerprint: _fingerprint, mode: _mode, ...data } = task;
    return { ...data, retryOfTaskId: task.retryOfTaskId ?? null };
  };
  const publicState = (state: SessionState): AppState => ({
    ...state,
    mode,
    generationEnabled: mode === "demo" || !!options.provider,
    tasks: state.tasks.map(publicTask),
  });
  const ownedProject = (state: SessionState, projectId: string) =>
    state.projects.find((project) => project.id === projectId) ??
    fail(404, "This car was not found.");
  const ownedTask = (state: SessionState, taskId: string) =>
    state.tasks.find((task) => task.id === taskId) ??
    fail(404, "This task was not found.");
  const imageData = (owner: string, url: string): Buffer => {
    const row = db
      .prepare("SELECT data FROM images WHERE id=? AND owner=?")
      .get(url.split("/").at(-1)!, owner) as { data: Uint8Array } | undefined;
    return row ? Buffer.from(row.data) : fail(404, "This image was not found.");
  };
  const putImage = (
    owner: string,
    projectId: string,
    bytes: Buffer,
  ): string => {
    const imageId = id();
    db.prepare("INSERT INTO images VALUES (?,?,?,?)").run(
      imageId,
      owner,
      projectId,
      bytes,
    );
    return `/api/images/${imageId}`;
  };
  const ledger = (
    state: SessionState,
    taskId: string,
    type: "reserve" | "settle" | "release",
    amount: number,
  ) => {
    state.ledger.push({ id: id(), taskId, type, amount, createdAt: now() });
  };
  function release(
    owner: string,
    taskId: string,
    status: "failed" | "cancelled",
    error: string,
  ) {
    if (closed) return;
    transaction(() => {
      const state = get(owner),
        task = ownedTask(state, taskId);
      if (!active(task)) return;
      task.status = status;
      task.error = error;
      state.credits += task.cost;
      state.reservedCredits -= task.cost;
      ledger(state, taskId, "release", task.cost);
      save(owner, state);
    });
  }
  function later(taskId: string, delay: number, fn: () => void) {
    const previous = timers.get(taskId);
    if (previous) clearTimeout(previous);
    timers.set(
      taskId,
      setTimeout(() => {
        timers.delete(taskId);
        if (!closed) fn();
      }, delay),
    );
  }
  async function run(owner: string, taskId: string) {
    if (closed) return;
    const state = get(owner),
      task = ownedTask(state, taskId);
    if (task.status !== "queued") return;
    task.status = "processing";
    save(owner, state);
    const controller = new AbortController();
    controllers.set(taskId, controller);
    try {
      const project = ownedProject(state, task.projectId);
      const base = task.baseVersionId
        ? project.versions.find((version) => version.id === task.baseVersionId)
        : undefined;
      let verified: Target | undefined;
      let output: Buffer;
      if (task.mode === "demo") {
        const previous = base?.verifiedTarget ?? {
          bodyColor: "blue",
          wheelColor: "bronze",
        };
        verified = {
          bodyColor:
            task.target.bodyColor === "keep"
              ? previous.bodyColor
              : task.target.bodyColor,
          wheelColor:
            task.target.wheelColor === "keep"
              ? previous.wheelColor
              : task.target.wheelColor,
        };
        output = await renderDemo(verified, task.styleId);
      } else {
        if (!options.provider) throw new Error("Image provider unavailable.");
        const source = imageData(owner, base?.imageUrl ?? project.originalUrl);
        const timeout = options.providerTimeoutMs ?? 180_000;
        output = await Promise.race([
          options.provider({
            image: source,
            imageMimeType: "image/png",
            styleId: task.styleId,
            intent: task.intent,
            target: task.target,
            projectName: project.name,
            signal: controller.signal,
          }),
          new Promise<never>((_resolve, reject) => {
            const abort = () => reject(new Error("Request interrupted."));
            controller.signal.addEventListener("abort", abort, { once: true });
            later(taskId, timeout, () => controller.abort());
          }),
        ]);
      }
      output = await normalizeImage(output);
      if (closed) return;
      transaction(() => {
        const fresh = get(owner),
          current = ownedTask(fresh, taskId);
        if (current.status !== "processing") return;
        const car = ownedProject(fresh, task.projectId);
        const version: Version = {
          id: id(),
          projectId: car.id,
          parentVersionId: task.baseVersionId,
          name: `${styleName(task.styleId)} · V${car.versions.length + 1}`,
          styleId: task.styleId,
          target: task.target,
          imageUrl: putImage(owner, car.id, output),
          favorite: false,
          createdAt: now(),
          demo: task.mode === "demo",
          ...(verified ? { verifiedTarget: verified } : {}),
        };
        car.versions.push(version);
        current.status = "succeeded";
        current.versionId = version.id;
        if (
          car.draft?.intent === task.intent &&
          car.draft.baseVersionId === task.baseVersionId &&
          car.draft.styleId === task.styleId &&
          car.draft.target.bodyColor === task.target.bodyColor &&
          car.draft.target.wheelColor === task.target.wheelColor
        )
          car.draft = null;
        fresh.reservedCredits -= current.cost;
        ledger(fresh, taskId, "settle", current.cost);
        save(owner, fresh);
      });
    } catch {
      if (!closed)
        release(
          owner,
          taskId,
          "failed",
          "This look could not be completed. Your credit was returned. You can try again.",
        );
    } finally {
      const timer = timers.get(taskId);
      if (timer) clearTimeout(timer);
      timers.delete(taskId);
      controllers.delete(taskId);
    }
  }
  function enqueue(owner: string, taskId: string) {
    later(taskId, options.queueDelayMs ?? 650, () => {
      void run(owner, taskId);
    });
  }
  for (const row of db.prepare("SELECT id,state FROM sessions").all() as {
    id: string;
    state: string;
  }[]) {
    const state: SessionState = JSON.parse(row.state);
    state.savedStyles ??= [];
    for (const task of state.tasks) {
      task.retryOfTaskId ??= null;
      if (task.status === "processing") {
        task.status = task.mode === "live" ? "uncertain" : "queued";
        task.error =
          task.mode === "live"
            ? "The provider request was interrupted. We will not submit it again automatically."
            : null;
      }
      if (task.status === "queued") enqueue(row.id, task.id);
      if (task.status === "uncertain")
        later(task.id, options.uncertainTimeoutMs ?? 30_000, () =>
          release(
            row.id,
            task.id,
            "failed",
            "The interrupted request could not be recovered. Your credit was returned.",
          ),
        );
    }
    save(row.id, state);
  }
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      if (
        req.get("sec-fetch-site") === "cross-site" ||
        (origin &&
          origin !== `${req.protocol}://${req.get("host")}` &&
          !options.allowedOrigins?.includes(origin))
      )
        return res
          .status(403)
          .json({ error: "This request must come from the same app." });
    }
    next();
  });
  app.use(express.json({ limit: "14mb" }));
  app.use("/api", (req, res, next) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith("form_session="))
      ?.slice("form_session=".length);
    let owner =
      token &&
      /^[a-f0-9]{64}$/.test(token) &&
      db.prepare("SELECT id FROM sessions WHERE id=?").get(token)
        ? token
        : undefined;
    if (!owner) {
      owner = randomBytes(32).toString("hex");
      const initial = Math.max(
        0,
        Math.floor(options.initialCredits ?? (mode === "demo" ? 12 : 0)),
      );
      save(owner, {
        credits: initial,
        reservedCredits: 0,
        projects: [],
        tasks: [],
        savedStyles: [],
        ledger: [
          {
            id: id(),
            taskId: null,
            type: "grant",
            amount: initial,
            createdAt: now(),
          },
        ],
      });
      res.cookie("form_session", owner, {
        httpOnly: true,
        sameSite: "strict",
        secure: req.secure,
        path: "/",
        maxAge: 365 * 24 * 60 * 60 * 1000,
      });
    }
    res.locals.owner = owner;
    next();
  });
  const route =
    (fn: (req: Request, res: Response) => unknown) =>
    (req: Request, res: Response, next: NextFunction) =>
      Promise.resolve()
        .then(() => fn(req, res))
        .catch(next);
  app.get("/api/health", (_req, res) => res.json({ ok: true, mode }));
  app.get(
    "/api/state",
    route((_req, res) => res.json(publicState(get(res.locals.owner)))),
  );
  app.get(
    "/api/images/:id",
    route((req, res) => {
      res
        .type("png")
        .send(imageData(res.locals.owner, `/api/images/${req.params.id}`));
    }),
  );
  app.post(
    "/api/projects",
    route(async (req, res) => {
      const input = req.body ?? {},
        owner = res.locals.owner;
      if (!["sample", "upload"].includes(input.source))
        return fail(400, "Choose a sample or upload a photo.");
      const projectName =
        input.name === undefined
          ? input.source === "sample"
            ? "Demo Golf"
            : "My car"
          : name(input.name);
      let bytes: Buffer;
      if (input.source === "sample")
        bytes = await readFile(
          new URL("../public/images/street-sport.jpg", import.meta.url),
        );
      else {
        if (
          typeof input.imageData !== "string" ||
          !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
            input.imageData,
          )
        )
          return fail(422, "Choose a JPEG, PNG or WebP photo.");
        bytes = Buffer.from(input.imageData.split(",")[1], "base64");
      }
      bytes = await normalizeImage(bytes);
      const state = get(owner);
      if (state.projects.length >= 50)
        return fail(
          422,
          "Your workspace can hold 50 cars. Remove one before adding another.",
        );
      let project!: Project;
      transaction(() => {
        project = {
          id: id(),
          name: projectName,
          source: input.source,
          originalUrl: "",
          draft: null,
          versions: [],
          createdAt: now(),
        };
        project.originalUrl = putImage(owner, project.id, bytes);
        state.projects.push(project);
        save(owner, state);
      });
      res.status(201).json(project);
    }),
  );
  function draftFor(
    state: SessionState,
    project: Project,
    value: unknown,
  ): Draft | null {
    if (value === null) return null;
    if (!value || typeof value !== "object")
      return fail(400, "This draft is invalid.");
    const draft = value as Draft;
    if (
      !STYLE_BY_ID[draft.styleId] ||
      !["explore", "refine"].includes(draft.intent)
    )
      return fail(400, "Choose a valid style and editing direction.");
    if (
      draft.intent === "refine" &&
      !project.versions.some((version) => version.id === draft.baseVersionId)
    )
      return fail(404, "This base version was not found.");
    if (draft.intent === "explore" && draft.baseVersionId !== null)
      return fail(400, "A new style starts from your original photo.");
    return {
      styleId: draft.styleId,
      intent: draft.intent,
      baseVersionId: draft.baseVersionId,
      target: validateTarget(draft.target),
      updatedAt: now(),
    };
  }
  app.patch(
    "/api/projects/:id",
    route((req, res) => {
      const owner = res.locals.owner,
        state = get(owner),
        project = ownedProject(state, String(req.params.id)),
        patch = req.body ?? {};
      const newName =
        patch.name === undefined ? project.name : name(patch.name);
      const draft =
        patch.draft === undefined
          ? project.draft
          : draftFor(state, project, patch.draft);
      project.name = newName;
      project.draft = draft;
      save(owner, state);
      res.json(project);
    }),
  );
  app.delete(
    "/api/projects/:id",
    route((req, res) => {
      const owner = res.locals.owner,
        state = get(owner),
        project = ownedProject(state, String(req.params.id));
      if (
        state.tasks.some(
          (task) => task.projectId === project.id && active(task),
        )
      )
        return fail(
          409,
          "Wait for or cancel this car’s active look before deleting.",
        );
      transaction(() => {
        state.projects = state.projects.filter(
          (item) => item.id !== project.id,
        );
        db.prepare("DELETE FROM images WHERE project_id=? AND owner=?").run(
          project.id,
          owner,
        );
        save(owner, state);
      });
      res.json({ ok: true });
    }),
  );
  app.patch(
    "/api/versions/:id",
    route((req, res) => {
      const owner = res.locals.owner,
        state = get(owner);
      const version =
        state.projects
          .flatMap((project) => project.versions)
          .find((item) => item.id === req.params.id) ??
        fail(404, "This version was not found.");
      const patch = req.body ?? {};
      if (patch.favorite !== undefined && typeof patch.favorite !== "boolean")
        return fail(400, "Invalid save selection.");
      if (patch.name !== undefined) version.name = name(patch.name);
      if (patch.favorite !== undefined) version.favorite = patch.favorite;
      save(owner, state);
      res.json(version);
    }),
  );
  app.patch(
    "/api/styles/:id",
    route((req, res) => {
      const styleId = String(req.params.id) as StyleId;
      if (!STYLE_BY_ID[styleId] || typeof req.body?.saved !== "boolean")
        return fail(400, "Choose a valid style to save.");
      const owner = res.locals.owner,
        state = get(owner);
      state.savedStyles = state.savedStyles.filter(
        (style) => style !== styleId,
      );
      if (req.body.saved) state.savedStyles.push(styleId);
      save(owner, state);
      res.json({ savedStyles: state.savedStyles });
    }),
  );
  app.post(
    "/api/tasks",
    route((req, res) => {
      const owner = res.locals.owner,
        state = get(owner),
        input = req.body as GenerateInput;
      if (
        !input ||
        typeof input.idempotencyKey !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(input.idempotencyKey)
      )
        return fail(400, "This confirmation is invalid.");
      if (
        input.retryOfTaskId !== undefined &&
        input.retryOfTaskId !== null &&
        (typeof input.retryOfTaskId !== "string" ||
          !input.retryOfTaskId.trim() ||
          input.retryOfTaskId.length > 128)
      )
        return fail(400, "This retry reference is invalid.");
      const retryOfTaskId = input.retryOfTaskId ?? null;
      const fingerprintParts = [
        input.projectId,
        input.styleId,
        input.intent,
        input.baseVersionId,
        input.target?.bodyColor,
        input.target?.wheelColor,
        input.consent,
      ];
      const fingerprint = JSON.stringify([...fingerprintParts, retryOfTaskId]);
      const legacyFingerprint = JSON.stringify(fingerprintParts);
      const previous = state.tasks.find(
        (task) => task.key === input.idempotencyKey,
      );
      if (previous) {
        if (
          previous.fingerprint !== fingerprint &&
          (retryOfTaskId !== null || previous.fingerprint !== legacyFingerprint)
        )
          return fail(
            409,
            "This confirmation was already used for a different look.",
          );
        return res.json(publicTask(previous));
      }
      if (state.tasks.some(active))
        return fail(
          409,
          "One look is already in progress. Open it or wait for it to finish.",
        );
      if (input.consent !== true)
        return fail(
          400,
          "Please confirm that you have permission to use this photo.",
        );
      if (
        !STYLE_BY_ID[input.styleId] ||
        !["explore", "refine"].includes(input.intent)
      )
        return fail(400, "Choose a valid style and direction.");
      const project = ownedProject(state, input.projectId),
        target = validateTarget(input.target);
      if (retryOfTaskId !== null) {
        const source = ownedTask(state, retryOfTaskId);
        if (source.status !== "failed")
          return fail(409, "Only a failed task can be retried.");
        if (
          source.projectId !== project.id ||
          source.styleId !== input.styleId ||
          source.intent !== input.intent ||
          source.baseVersionId !== input.baseVersionId ||
          source.target.bodyColor !== target.bodyColor ||
          source.target.wheelColor !== target.wheelColor
        )
          return fail(
            409,
            "A retry must use the failed task's original request.",
          );
      }
      if (input.intent === "refine") {
        const base =
          project.versions.find(
            (version) => version.id === input.baseVersionId,
          ) ?? fail(404, "This base version was not found.");
        if (base.styleId !== input.styleId)
          return fail(
            400,
            "Refine this version’s current style or explore another style from the original.",
          );
        if (target.bodyColor === "keep" && target.wheelColor === "keep")
          return fail(400, "Select at least one change before generating.");
      } else if (input.baseVersionId !== null)
        return fail(400, "A new style starts from your original photo.");
      if (mode === "demo" && project.source === "upload")
        return fail(
          422,
          "Your photo needs a live image provider. Try the demo car to explore the workflow.",
        );
      if (mode === "live" && !options.provider)
        return fail(422, "Image generation is not configured yet.");
      if (state.credits < 1)
        return fail(402, "You have no credits available for another look.");
      const task: StoredTask = {
        id: id(),
        projectId: project.id,
        status: "queued",
        intent: input.intent,
        styleId: input.styleId,
        baseVersionId: input.baseVersionId,
        target,
        versionId: null,
        error: null,
        cost: 1,
        createdAt: now(),
        retryOfTaskId,
        key: input.idempotencyKey,
        fingerprint,
        mode,
      };
      transaction(() => {
        state.credits--;
        state.reservedCredits++;
        state.tasks.push(task);
        ledger(state, task.id, "reserve", 1);
        save(owner, state);
      });
      enqueue(owner, task.id);
      res.status(202).json(publicTask(task));
    }),
  );
  app.get(
    "/api/tasks/:id",
    route((req, res) =>
      res.json(
        publicTask(ownedTask(get(res.locals.owner), String(req.params.id))),
      ),
    ),
  );
  app.post(
    "/api/tasks/:id/cancel",
    route((req, res) => {
      const owner = res.locals.owner,
        taskId = String(req.params.id);
      ownedTask(get(owner), taskId);
      release(
        owner,
        taskId,
        "cancelled",
        "This look was cancelled. Your credit was returned.",
      );
      const timer = timers.get(taskId);
      if (timer) clearTimeout(timer);
      timers.delete(taskId);
      controllers.get(taskId)?.abort();
      res.json(publicTask(ownedTask(get(owner), taskId)));
    }),
  );
  app.post(
    "/api/tasks/:id/report",
    route((req, res) => {
      const owner = res.locals.owner,
        task = ownedTask(get(owner), String(req.params.id));
      const reason = req.body?.reason;
      if (typeof reason !== "string" || !reason.trim() || reason.length > 1000)
        return fail(400, "Add a short description of the problem.");
      const report: Report = {
        id: id(),
        taskId: task.id,
        reason: reason.trim(),
        createdAt: now(),
      };
      db.prepare("INSERT INTO reports VALUES (?,?,?,?,?)").run(
        report.id,
        owner,
        task.id,
        report.reason,
        report.createdAt,
      );
      res.status(201).json(report);
    }),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "This resource was not found." }),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const status =
        error instanceof HttpError
          ? error.status
          : (error as { status?: number })?.status === 413
            ? 413
            : (error as { status?: number })?.status === 400
              ? 400
              : 500;
      res.status(status).json({
        error:
          error instanceof HttpError
            ? error.message
            : status === 413
              ? "Please choose an image smaller than 10 MB."
              : status === 400
                ? "This request could not be read."
                : "Something went wrong. Please try again.",
      });
    },
  );
  return {
    app,
    async close() {
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      db.close();
    },
  };
}
