import { NextResponse } from "next/server";
import { parseJson, withAdmin, withUser } from "@/lib/route-helpers";
import {
  ONLINE_LOOKUPS_KEY,
  onlineLookupsDecided,
  onlineLookupsEnabled,
  setSetting,
} from "@/lib/app-settings";

// The online-lookups consent. GET is session-gated (the UI needs it to
// know whether to show lookup affordances); PUT is admin-only — this is
// a deployment-wide decision about what leaves the machine.
export const GET = withUser(async () => {
  return NextResponse.json({
    onlineLookups: await onlineLookupsEnabled(),
    decided: await onlineLookupsDecided(),
  });
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
