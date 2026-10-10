import { readFile, writeFile } from "node:fs/promises";

const frontendPackages = [
  "react",
  "react-dom",
  "scheduler",
  "lucide-react",
  "react-compare-slider",
];
const packages = [...frontendPackages, "express", "sharp"];
const sections = new Map();
for (const name of packages) {
  const root = new URL(`../node_modules/${name}/`, import.meta.url);
  const metadata = JSON.parse(
    await readFile(new URL("package.json", root), "utf8"),
  );
  const license = await readFile(new URL("LICENSE", root), "utf8");
  sections.set(
    name,
    `## ${name} ${metadata.version} (${metadata.license})\n\n${license.trim()}\n`,
  );
}
await writeFile(
  new URL("../THIRD_PARTY_NOTICES.md", import.meta.url),
  "# Third-party notices\n\n" +
    "Original notices for directly adopted runtime libraries and the bundled React scheduler. " +
    "Additional npm runtime dependencies retain their notices in their installed packages.\n\n" +
    packages.map((name) => sections.get(name)).join("\n"),
);
await writeFile(
  new URL("../public/third-party-notices.txt", import.meta.url),
  "FORM frontend — third-party notices\n\n" +
    frontendPackages.map((name) => sections.get(name)).join("\n"),
);
console.log("Wrote runtime and frontend third-party notices.");
