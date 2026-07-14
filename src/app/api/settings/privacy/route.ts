import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson, withAdmin, withUser } from "@/lib/route-helpers";
import {
  ONLINE_LOOKUPS_KEY,
  onlineLookupsDecided,
  onlineLookupsEnabled,
  setSetting,
} from "@/lib/app-settings";

// The online-lookups consent AND its receipt. GET is session-gated (the
// UI needs it to know whether to show lookup affordances) and carries
// the control half of "consent and control": how many books actually
// have OpenLibrary-derived rows, so past egress is visible, not buried.
// PUT is admin-only — a deployment-wide decision about what leaves the
// machine.
export const GET = withUser(async () => {
  const [lookedUpBooks, pendingRows] = await Promise.all([
    prisma.bookSuggestion.groupBy({ by: ["bookId"] }).then((g) => g.length),
    prisma.bookSuggestion.count({ where: { status: { not: "accepted" } } }),
  ]);
  return NextResponse.json({
    onlineLookups: await onlineLookupsEnabled(),
    decided: await onlineLookupsDecided(),
    lookedUpBooks,
    purgeableRows: pendingRows,
  });
});

// DELETE — purge the inbound residue that was never acted on: every
// suggestion row except accepted ones (an accept was an explicit human
// choice whose fields were deliberately written onto the book; deleting
// those would silently undo curation, which is its own trust break).
export const DELETE = withAdmin(async () => {
  const { count } = await prisma.bookSuggestion.deleteMany({
    where: { status: { not: "accepted" } },
  });
  return NextResponse.json({ ok: true, purged: count });
});

interface PrivacyPayload {
  onlineLookups?: unknown;
}

export const PUT = withAdmin(async (_admin, req) => {
  const parsed = await parseJson<PrivacyPayload>(req);
  if (!parsed.ok) return parsed.res;
  if (typeof parsed.body.onlineLookups !== "boolean") {
    return NextResponse.json(
      { error: "onlineLookups must be a boolean" },
      { status: 400 },
    );
  }
  await setSetting(ONLINE_LOOKUPS_KEY, parsed.body.onlineLookups ? "on" : "off");
  return NextResponse.json({ ok: true, onlineLookups: parsed.body.onlineLookups });
});
