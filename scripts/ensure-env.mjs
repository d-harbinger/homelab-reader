#!/usr/bin/env node
// ensure-env — dev-path parity with docker-entrypoint.sh.
//
// Scaffolds the env file, generates a signing secret, and ensures the dev data
// directory exists, so a fresh clone runs with no manual setup step. Wired into
// `predev` and runs BEFORE preflight.mjs, so preflight validates the fixed
// state rather than reporting problems this script would have solved.
//
// Idempotent: never overwrites a value that is already set. The container path
// does the same work in docker-entrypoint.sh; this keeps the two in step.
import {
  readFileSync,
  existsSync,
  appendFileSync,
  copyFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { randomBytes } from "node:crypto";

function hasValue(path, key) {
  if (!existsSync(path)) return false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.startsWith(key + "=")) continue;
    const val = line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
    if (val) return true;
  }
  return false;
}

// 1. .env from the committed template
if (existsSync(".env")) {
  console.log("• .env already exists — leaving it alone");
} else if (existsSync(".env.example")) {
  copyFileSync(".env.example", ".env");
  console.log("✓ created .env from .env.example");
} else {
  writeFileSync(".env", "");
  console.log("✓ created empty .env (no .env.example to copy)");
}

// 2. AUTH_SECRET → .env.local (Next loads it with precedence over .env, so
//    this wins over the empty template value). Same 32 random bytes that
//    `npx auth secret` would write.
if (hasValue(".env", "AUTH_SECRET") || hasValue(".env.local", "AUTH_SECRET")) {
  console.log("• AUTH_SECRET already set — leaving it alone");
} else {
  appendFileSync(".env.local", `AUTH_SECRET=${randomBytes(32).toString("base64")}\n`);
  console.log("✓ generated AUTH_SECRET → .env.local");
}

// 3. Dev SQLite directory (prod uses /data via the container)
mkdirSync("data", { recursive: true });

console.log("  • Set BOOKS_PATH in .env to your library folder (optional — empty is fine to start)");
