import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const installedChromium = [1243, 1234, 1223]
  .map((build) =>
    join(
      homedir(),
      `Library/Caches/ms-playwright/chromium-${build}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    ),
  )
  .find((path) => existsSync(path));

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5174",
    launchOptions: {
      executablePath: process.env.FORM_TEST_CHROMIUM ?? installedChromium,
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:test",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
