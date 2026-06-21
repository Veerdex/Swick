// Cross-platform test runner: finds every *.test.ts under src/ and runs them
// through Node's built-in test runner with the tsx loader.
//
// Node 20's `--test` flag doesn't expand globs, and npm on Windows doesn't
// either, so we discover the files ourselves and pass them explicitly.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".test.ts")) files.push(path);
  }
})("src");

if (files.length === 0) {
  console.log("No test files found (looked for *.test.ts under src/).");
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
