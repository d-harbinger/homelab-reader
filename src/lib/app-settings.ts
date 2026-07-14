// Deployment-wide settings (AppSetting key/value rows). The first and
// load-bearing one is the online-lookups consent: whether this install
// may contact OpenLibrary at all. THE DEFAULT IS OFF and unset means
// off — a fresh deployment sends nothing anywhere until a human reads
// the plain-language disclosure (setup step / Settings → Privacy) and
// enables it. Both egress paths check this: enrich-on-import in the
// scanner and the sorting bench's auto-shelve batches.
import { prisma } from "@/lib/prisma";

export const ONLINE_LOOKUPS_KEY = "onlineLookups";
// Distinguishes "never asked" (setup should ask) from a decided "off".
export const ONLINE_LOOKUPS_UNDECIDED = "undecided";

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function onlineLookupsEnabled(): Promise<boolean> {
  return (await getSetting(ONLINE_LOOKUPS_KEY)) === "on";
}

export async function onlineLookupsDecided(): Promise<boolean> {
  const v = await getSetting(ONLINE_LOOKUPS_KEY);
  return v === "on" || v === "off";
}
