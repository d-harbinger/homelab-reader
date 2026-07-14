import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdmin } from "@/lib/route-helpers";

// PATCH /api/scan/failures/[id] — "stop telling me about this file."
// Admin-only (the banner is shared by every user, so hiding an entry is
// a curation act). The row stays in the table: if the file's contents
// ever change, the re-scan clears it entirely and a fixed file imports
// as normal — dismissal is display-state, never data loss.
type FailureContext = { params: Promise<{ id: string }> };

export const PATCH = withAdmin<FailureContext>(async (_admin, _req, ctx) => {
  const { id } = await ctx.params;
  try {
    await prisma.failedImport.update({ where: { id }, data: { dismissed: true } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
