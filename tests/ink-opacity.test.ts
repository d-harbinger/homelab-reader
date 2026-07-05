// The ink Draw tool's opacity presets: exact-set validation (same contract as
// widths/colors — the API accepts only known values) and the backfill story
// (strokes saved before the field existed must render fully opaque).
import { describe, it, expect } from "vitest";
import { INK_OPACITIES, isInkOpacity } from "@/lib/ink";

describe("ink opacity presets", () => {
  it("accepts exactly the preset values", () => {
    for (const o of INK_OPACITIES) expect(isInkOpacity(o.value)).toBe(true);
    expect(isInkOpacity(0.5)).toBe(false); // not a preset
    expect(isInkOpacity(0)).toBe(false); // invisible ink is not a thing
    expect(isInkOpacity("1")).toBe(false);
    expect(isInkOpacity(undefined)).toBe(false);
  });

  it("includes Solid=1 so the default matches the pre-field rendering", () => {
    expect(INK_OPACITIES[0]).toEqual({ name: "Solid", value: 1 });
  });
});
