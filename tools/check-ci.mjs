import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/form-pr.yml", "utf8");
for (const forbidden of ["pull_request_target", "secrets.", "npm publish", "cap:run", "macos-", "ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION"]) {
  if (workflow.includes(forbidden)) throw new Error(`forbidden CI capability: ${forbidden}`);
}
if (/\bsecrets\s*(?:\.|\[)/i.test(workflow)) throw new Error("secret expressions are forbidden");
if (!/^on:\s*\n\s+pull_request:/m.test(workflow)) throw new Error("workflow must trigger only on pull_request");
const eventBlock = workflow.match(/^on:\s*\n((?:[ \t]+.*\n|\n)*)/m)?.[1].trim();
if (eventBlock !== "pull_request:") throw new Error("unexpected workflow trigger");
if (!workflow.includes("contents: read")) throw new Error("contents:read permission required");
if (/:\s*write(?:\s|$)/m.test(workflow)) throw new Error("write permissions are forbidden");
if (!workflow.includes("runs-on: ubuntu-24.04")) throw new Error("approved Linux runner required");
for (const action of ["actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8", "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444"]) {
  if (!workflow.includes(`uses: ${action}`)) throw new Error("verified Node24 Action pin required");
}
const runs = [...workflow.matchAll(/^\s+run:\s*(.+)$/gm)].map(match => match[1].trim());
if (runs.some(command => /\b(?:deploy|publish|upload|push)\b/i.test(command))) throw new Error("deployment, publication and upload commands are forbidden");
const legacyBrowser = String.raw`npm run test:e2e -- 'tests/e2e/(?!v2-).*\.spec\.ts'`;
for (const required of ["npm ci", "node tools/check-ci.mjs", "npm test", "node tools/check-v2.mjs", "npm run build", "npx playwright install --with-deps chromium", legacyBrowser, "npx --no-install playwright test --config=playwright.v2.config.ts"]) {
  if (!runs.includes(required)) throw new Error(`missing CI step: ${required}`);
}
if (runs.includes("npm run test:e2e")) throw new Error("browser suites must use separate servers");
const componentConfig = readFileSync("playwright.v2.config.ts", "utf8");
if (!componentConfig.includes("testMatch: 'v2-*.spec.ts'") || !componentConfig.includes("command: 'node tools/dev-test-v2.mjs'")) throw new Error("V2 component harness must stay explicit");
console.log("CI policy checks passed");
