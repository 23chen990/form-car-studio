import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/form-pr.yml", "utf8");
for (const forbidden of ["pull_request_target", "secrets.", "npm publish", "cap:run", "macos-"]) {
  if (workflow.includes(forbidden)) throw new Error(`forbidden CI capability: ${forbidden}`);
}
if (!/^on:\s*\n\s+pull_request:/m.test(workflow)) throw new Error("workflow must trigger only on pull_request");
if (!workflow.includes("contents: read")) throw new Error("contents:read permission required");
for (const required of ["npm ci", "npm test", "node tools/check-v2.mjs", "npm run build", "npm run test:e2e"]) {
  if (!workflow.includes(required)) throw new Error(`missing CI step: ${required}`);
}
console.log("CI policy checks passed");
