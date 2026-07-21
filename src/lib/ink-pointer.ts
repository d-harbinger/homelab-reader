// Which pointer may lay ink, and the session latch that decides it.
//
// The rule cannot be expressed in CSS. `touch-action` governs every
// direct-manipulation pointer type at once — pen included, on the tablets where
// a stylus can pan — so there is no way to declare "the pen draws, the finger
// scrolls". That exact note-taking case is a known gap in the spec and is still
// open as w3c/pointerevents#203. So the split is made here, on the event's own
// pointerType, and the overlay keeps touch-action: none for every pointer.
//
// The latch lives here rather than in ink.ts because /api/ink imports ink.ts:
// module-level mutable state in that file would be shared by every request the
// server process handles, not by one reader's session.

let sessionPenSeen = false;

/**
 * Record the instrument behind a pointer event.
 *
 * The latch is one-way on purpose: a stylus user who sets the pen down for a
 * moment is still a stylus user, and a rule that flipped back to "fingers draw"
 * the instant the pen lifted would let the hand holding the tablet paint.
 */
export function notePointerType(pointerType: string): void {
  if (pointerType === "pen") sessionPenSeen = true;
}

/** Whether a stylus has touched an ink overlay yet this session. */
export function hasSeenPen(): boolean {
  return sessionPenSeen;
}

/**
 * True when a pointer should lay ink rather than be ignored. Pure — the latch is
 * passed in rather than read — so every branch is decidable without a session.
 */
export function inkPointerDraws(
  pointerType: string,
  isPrimary: boolean,
  penSeen: boolean,
): boolean {
  // A palm settling beside the nib, or a second finger, arrives as a non-primary
  // pointer. Never a stroke, whatever the instrument.
  if (!isPrimary) return false;
  // Once a stylus has been seen, touch is the hand holding the tablet rather
  // than the instrument — the automatic palm rejection every stylus note app
  // does. Before that, touch is the only instrument the reader has, so it draws.
  if (pointerType === "touch") return !penSeen;
  // A pen or a mouse is always deliberate.
  return true;
}

/**
 * True when a pointer should PAN the reading surface rather than lay ink — the
 * other half of the split. A finger that isn't the instrument (the hand holding
 * the tablet once a stylus has been seen, or a second finger) should scroll the
 * page even while draw mode owns the overlay. Only touch pans: a mouse scrolls
 * with the wheel and a pen always draws. Pure for the same reason as above.
 */
export function inkPointerPans(
  pointerType: string,
  isPrimary: boolean,
  penSeen: boolean,
): boolean {
  if (pointerType !== "touch") return false;
  return !inkPointerDraws(pointerType, isPrimary, penSeen);
}
