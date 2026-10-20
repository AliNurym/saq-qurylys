import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function collect(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...collect(path));
    else if (/\.(?:mjs|js)$/u.test(path)) files.push(path);
  }
  return files;
}

const root = process.cwd();
const jsFiles = ["src", "scripts", "test", "public"].flatMap((directory) => collect(resolve(root, directory)));
const errors = [];
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) errors.push(file + ": " + (result.stderr || result.stdout).trim());
  const source = readFileSync(file, "utf8");
  if (file !== resolve(root, "scripts/lint.mjs") && source.includes("dangerouslySetInnerHTML")) {
    errors.push(file + ": raw HTML injection helper is prohibited.");
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Lint passed: " + jsFiles.length + " JavaScript files parsed; no raw-HTML injection helper found.");
