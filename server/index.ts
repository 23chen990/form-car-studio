import { resolve } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import { createApp } from "./app";
import { createLiveProvider } from "./provider";

if (existsSync(".env")) process.loadEnvFile(".env");
const mode = process.env.FORM_MODE === "live" ? "live" : "demo";
const provider =
  mode === "live" && process.env.IMAGE_API_KEY && process.env.IMAGE_MODEL
    ? createLiveProvider({
        apiKey: process.env.IMAGE_API_KEY,
        model: process.env.IMAGE_MODEL,
        baseUrl: process.env.IMAGE_BASE_URL,
      })
    : undefined;
const creditValue = process.env.FORM_INITIAL_CREDITS;
if (creditValue && !/^\d+$/.test(creditValue))
  throw new Error("FORM_INITIAL_CREDITS must be a non-negative integer.");
const instance = createApp({
  dataDir: resolve(process.env.FORM_DATA_DIR ?? "data"),
  mode,
  provider,
  initialCredits: creditValue === undefined ? undefined : Number(creditValue),
  allowedOrigins: (process.env.FORM_WEB_ORIGIN ?? "http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim()),
});
const dist = resolve("dist");
if (existsSync(dist)) {
  instance.app.use(express.static(dist));
  instance.app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve(dist, "index.html")),
  );
}
const port = Number(process.env.PORT ?? 3001);
const server = instance.app.listen(port, "127.0.0.1", () =>
  console.log(`FORM API · ${mode} · http://127.0.0.1:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void instance.close().then(() => {
      server.closeAllConnections();
      server.close(() => process.exit(0));
    });
  });
