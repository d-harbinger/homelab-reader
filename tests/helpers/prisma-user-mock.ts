// A "@/lib/prisma" stand-in for suites that test the GATE and nothing else.
//
// Those suites (route-helpers, authz-gates, fs-route) assert 401/403 and the
// admin happy-path handoff; they have no data path and want no database. The
// gate does read one row now, though — see src/lib/current-user.ts — so the
// module has to answer `user.findUnique`. It answers it from the same session
// store that drives the mocked `auth()`, which means:
//
//   - the role the test asked for is the role the gate reads, and
//   - signing out (or naming an id with no row) produces a genuine miss,
//     exercising the deleted-account branch rather than papering over it.
//
// Every other model is deliberately absent: a suite that reaches past the gate
// into data belongs on an ephemeral database (tests/helpers/test-db.ts), and a
// TypeError here is the signal that it drifted.

import { storedSession } from "./session-store";

export const prisma = {
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const session = storedSession();
      if (!session || session.id !== where.id) return null;
      return {
        id: session.id,
        username: `session-${session.id}`,
        role: session.role,
      };
    },
  },
} as unknown as import("@prisma/client").PrismaClient;
