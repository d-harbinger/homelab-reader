#!/usr/bin/env node
// Reset an existing user's password — recovery for a locked-out account
// (e.g. a forgotten admin password). Normal accounts are created through
// first-run setup (/setup) and the admin user-management page.
//
//   node scripts/set-password.mjs <username>            # masked prompt
//   node scripts/set-password.mjs <username> 'newpass'  # non-interactive
//
// Hashes with bcrypt and updates the named user's row. The user must
// already exist; this script does not create accounts.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

// Minimal .env loader so a bare `node` run sees DATABASE_URL etc. without a
// dotenv dependency. Only fills vars that aren't already set.
function loadDotEnv(path = ".env") {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return; // no file — rely on the ambient environment
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function promptMasked(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.stdoutMuted = true;
    // Mask keystrokes with asterisks.
    rl._writeToOutput = (str) => {
      if (rl.stdoutMuted && !str.includes(question)) {
        rl.output.write("*");
      } else {
        rl.output.write(str);
      }
    };
    rl.question(question, (answer) => {
      rl.output.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  loadDotEnv();

  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Add it to .env (dev) or the environment (Docker).",
    );
    process.exit(1);
  }

  const username = process.argv[2]?.trim();
  if (!username) {
    console.error("Usage: node scripts/set-password.mjs <username> [newpassword]");
    process.exit(1);
  }

  let password = process.argv[3];
  if (!password) {
    password = await promptMasked(`New password for "${username}": `);
  }
  if (!password || password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (!existing) {
      const all = await prisma.user.findMany({ select: { username: true } });
      const names = all.map((u) => u.username).join(", ") || "(none)";
      console.error(
        `No user named "${username}". Existing users: ${names}.\n` +
          "Create accounts through first-run setup or the admin Users page.",
      );
      process.exit(1);
    }
    await prisma.user.update({
      where: { username },
      data: { passwordHash },
    });
    console.log(`Password reset for "${username}".`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
