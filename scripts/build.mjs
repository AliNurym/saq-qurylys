import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const required = [
  "src/server.mjs",
  "src/db.mjs",
  "src/http-policy.mjs",
  "src/backup-service.mjs",
  "scripts/backup.mjs",
  "ops/Caddyfile.example",
  "docs/deployment.md",
  "docs/backup-recovery.md",
  "docs/signal-inbox.md",
  "docs/object-conditions.md",
  "docs/complaints.md",
  "docs/transaction-consistency.md",
  "docs/audit-history.md",
  "docs/page-capture.md",
  "src/page-capture.mjs",
  "src/risk-engine.mjs",
  "src/ai-analyzer.mjs",
  "models/payment-linear-v1.json",
  "public/index.html",
  "public/app.js",
  "public/styles.css",
  "public/saq-theme.css",
  "public/construction-ui.js",
  "public/construction.css",
  "public/favicon.svg",
  "public/access-ui.js",
  "public/access.css",
  "public/calendar-ui.js",
  "public/calendar.css",
  "public/collection-ui.js",
  "public/collection.css",
  "public/signal-inbox-ui.js",
  "public/signal-inbox.css",
  "src/signal-inbox.mjs",
  "src/object-conditions.mjs",
  "src/complaint-service.mjs",
  "public/complaints-ui.js",
  "public/complaints.css",
  "public/object-conditions-ui.js",
  "public/object-conditions.css",
  "public/fonts/InterVariable.woff2",
  "public/fonts/Inter-LICENSE.txt",
  "README.md",
  "docs/architecture.md",
  "docs/demo-script.md",
  "docs/ai.md",
  "docs/pitch.md",
];
const missing = required.filter((file) => !statSync(resolve(root, file), { throwIfNoEntry: false }));
if (missing.length) {
  console.error("Build check failed; missing files: " + missing.join(", "));
  process.exit(1);
}

function collect(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...collect(path));
    else if (/\.(?:mjs|js)$/u.test(path)) files.push(path);
  }
  return files;
}

const files = ["src", "scripts", "test", "public"].flatMap((directory) => collect(resolve(root, directory)));
for (const file of files) {
  const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (check.status !== 0) {
    console.error("Syntax check failed: " + file);
    console.error(check.stderr || check.stdout);
    process.exit(1);
  }
}
console.log("Build check passed: " + files.length + " JavaScript files parse and required assets are present.");
