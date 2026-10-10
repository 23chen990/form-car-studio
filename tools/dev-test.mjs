import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dataDir = await mkdtemp(join(tmpdir(), "form-browser-"));
const api = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: "3002",
    FORM_DATA_DIR: dataDir,
    FORM_MODE: "demo",
    FORM_WEB_ORIGIN: "http://127.0.0.1:5174",
  },
});
const web = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "5174",
    "--strictPort",
  ],
  { stdio: "inherit", env: { ...process.env, FORM_API_PORT: "3002" } },
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  api.kill("SIGTERM");
  web.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
api.on("exit", stop);
web.on("exit", stop);
await Promise.all([
  new Promise((resolve) => api.on("close", resolve)),
  new Promise((resolve) => web.on("close", resolve)),
]);
await rm(dataDir, { recursive: true, force: true });
