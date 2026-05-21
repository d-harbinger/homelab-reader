import { prisma } from "./prisma";

// Until real auth lands, all Progress / Note / Highlight rows hang off a
// single "local" user. When NextAuth is wired in, the existing rows
// either migrate (rename the user) or the schema picks up a real one
// — no data loss either way because the rows survive a username change.
const DEFAULT_USERNAME = "local";

let cachedId: string | null = null;

export async function getDefaultUserId(): Promise<string> {
  if (cachedId) return cachedId;
  const user = await prisma.user.upsert({
    where: { username: DEFAULT_USERNAME },
    create: { username: DEFAULT_USERNAME, passwordHash: "" },
    update: {},
  });
  cachedId = user.id;
  return user.id;
}
