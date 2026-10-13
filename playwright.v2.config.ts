import { chromium, defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const chromiumPath = process.env.FORM_TEST_CHROMIUM ?? chromium.executablePath();
if (!chromiumPath || !existsSync(chromiumPath)) {
  throw new Error('Set FORM_TEST_CHROMIUM to an already installed Chromium executable. Browser downloads are disabled.');
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'v2-*.spec.ts',
  timeout: 30_000,
  workers: 1,
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:4174',
    launchOptions: { executablePath: chromiumPath },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tools/dev-test-v2.mjs',
    url: 'http://127.0.0.1:4174/tests/harness/v2.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
