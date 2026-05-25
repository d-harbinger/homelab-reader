#!/usr/bin/env node
// Preflight: verify the environment is ready before the dev server starts,
// and fail with a readable checklist instead of a cryptic Prisma (P1012) or
// Auth.js (MissingSecret) stack trace. Wired into `predev`.
//
// Fails safe: only an explicitly-missing required variable stops the boot.
// Any unexpected error in this script logs a note and gets out of the way,
// so a bug here can never brick `npm run dev`.
import { readFileSync, existsSync } from "node:fs";

function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    if (/^\s*#/.test(line) || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) out[key] = val;
  }
  return out;
}

// Precedence mirrors Next.js: .env.local overrides .env, and a real
// process.env value wins over both.
function loadEnv() {
  const merged = { ...parseEnvFile(".env"), ...parseEnvFile(".env.local") };
  for (const [k, v] of Object.entries(process.env)) {
    if (v) merged[k] = v;
  }
  return merged;
}

const C = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

function fail(lines) {
  console.error(
    `\n${C.red}${C.bold}✖ homelab-reader can't start — setup incomplete${C.reset}\n`,
  );
  for (const l of lines) console.error("  " + l);
  console.error(
    `\n  ${C.dim}Or run ${C.reset}npm run setup${C.dim} to scaffold all of this at once.${C.reset}\n`,
  );
  process.exit(1);
}

try {
  if (!existsSync(".env") && !existsSync(".env.local")) {
    fail([
      "No .env file found.",
      `${C.dim}→ ${C.reset}npm run setup${C.dim}  (copies .env.example and generates a signing secret)${C.reset}`,
    ]);
  }

  const env = loadEnv();
  const problems = [];

  if (!env.DATABASE_URL) {
    problems.push(`${C.bold}DATABASE_URL${C.reset} is not set.`);
    problems.push(
      `   ${C.dim}→ ${C.reset}cp .env.example .env${C.dim}  (it comes prefilled there)${C.reset}`,
    );
  }
  if (!env.AUTH_SECRET) {
    problems.push(
      `${C.bold}AUTH_SECRET${C.reset} is not set — login sessions can't be signed.`,
    );
    problems.push(
      `   ${C.dim}→ ${C.reset}npx auth secret${C.dim}  (writes .env.local), then restart${C.reset}`,
    );
  }

  if (problems.length) fail(problems);

  if (!env.BOOKS_PATH) {
    console.warn(
      `${C.yellow}⚠ BOOKS_PATH is not set${C.reset} — the library will be empty until it points at a folder of books.`,
    );
  }
} catch (e) {
  console.warn(`(preflight check skipped: ${e?.message ?? e})`);
}
