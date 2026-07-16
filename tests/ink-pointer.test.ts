// Which pointer is allowed to lay ink on a reader's overlay.
//
// The rule exists because CSS cannot express it: touch-action governs every
// direct-manipulation pointer type at once, so "the pen draws, the finger
// scrolls" has to be decided in the handler, per event. inkPointerDraws is pure
// (the latch is passed in), so every branch is decidable here; notePointerType
// carries the one-way session latch that feeds it.
//
// Branches exercised:
//   inkPointerDraws — non-primary touch/pen/mouse -> never draws · touch before
//                     any pen -> draws · touch after a pen -> does not · pen ->
//                     always draws, latch or no latch · mouse -> always draws
//   latch           — starts unset · touch and mouse never set it · a pen sets
//                     it · it stays set once a pen has been seen

import { describe, expect, it } from "vitest";
import { hasSeenPen, inkPointerDraws, notePointerType } from "@/lib/ink-pointer";

describe("inkPointerDraws", () => {
  it("never draws for a non-primary pointer, whatever the instrument", () => {
    // The palm beside the nib and the second finger both arrive this way.
    for (const type of ["touch", "pen", "mouse"]) {
      expect(inkPointerDraws(type, false, false)).toBe(false);
      expect(inkPointerDraws(type, true, false)).toBe(true);
    }
  });

  it("lets touch draw until a stylus has been seen", () => {
    // A finger is the only instrument a tablet-without-stylus user has.
    expect(inkPointerDraws("touch", true, false)).toBe(true);
  });

  it("stops touch from drawing once a stylus has been seen", () => {
    // Automatic palm rejection: after a pen, touch is the hand holding the slab.
    expect(inkPointerDraws("touch", true, true)).toBe(false);
  });

  it("always draws for a pen", () => {
    expect(inkPointerDraws("pen", true, false)).toBe(true);
    expect(inkPointerDraws("pen", true, true)).toBe(true);
  });

  it("always draws for a mouse", () => {
    // A mouse cannot pan the page by dragging, so the latch is irrelevant to it.
    expect(inkPointerDraws("mouse", true, false)).toBe(true);
    expect(inkPointerDraws("mouse", true, true)).toBe(true);
  });
});

// One monotonic sequence rather than four isolated cases: the latch is
// module-level session state on purpose, and asserting it in order is what
// proves the one-way behavior the palm rejection rests on.
describe("the session pen latch", () => {
  it("starts unset, and neither touch nor mouse sets it", () => {
    expect(hasSeenPen()).toBe(false);
    notePointerType("touch");
    notePointerType("mouse");
    expect(hasSeenPen()).toBe(false);
  });

  it("is set by a pen and never clears again", () => {
    notePointerType("pen");
    expect(hasSeenPen()).toBe(true);
    // The pen lifting does not make the user a finger user again.
    notePointerType("touch");
    notePointerType("mouse");
    expect(hasSeenPen()).toBe(true);
  });
});
