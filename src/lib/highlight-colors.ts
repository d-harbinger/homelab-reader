// Shared color palette for highlights — same values used by the reader
// popover, the rendered annotation, and any future highlight list view.
//
// Colors are intentionally soft (40% alpha) so they overlay book text
// without losing legibility. Names map 1:1 to the validated color values
// the /api/highlights routes accept.

export type HighlightColor =
  | "yellow"
  | "green"
  | "blue"
  | "pink"
  | "orange"
  | "purple"
  | "red";

export const HIGHLIGHT_COLORS: Record<
  HighlightColor,
  { fill: string; label: string; swatch: string }
> = {
  yellow: {
    fill: "rgba(251, 191, 36, 0.4)",
    swatch: "#fbbf24",
    label: "Yellow",
  },
  green: {
    fill: "rgba(52, 211, 153, 0.4)",
    swatch: "#34d399",
    label: "Green",
  },
  blue: {
    fill: "rgba(96, 165, 250, 0.4)",
    swatch: "#60a5fa",
    label: "Blue",
  },
  pink: {
    fill: "rgba(244, 114, 182, 0.4)",
    swatch: "#f472b6",
    label: "Pink",
  },
  orange: {
    fill: "rgba(251, 146, 60, 0.4)",
    swatch: "#fb923c",
    label: "Orange",
  },
  purple: {
    fill: "rgba(167, 139, 250, 0.4)",
    swatch: "#a78bfa",
    label: "Purple",
  },
  red: {
    fill: "rgba(248, 113, 113, 0.4)",
    swatch: "#f87171",
    label: "Red",
  },
};

export const HIGHLIGHT_ORDER: HighlightColor[] = [
  "yellow",
  "green",
  "blue",
  "pink",
  "orange",
  "purple",
  "red",
];

// The canonical set of accepted color names, derived from the palette so the
// reader popover, the rendered annotation, and the /api/highlights route
// validation can never drift. Single source of truth — do not inline a copy.
export const VALID_HIGHLIGHT_COLORS = new Set<string>(
  Object.keys(HIGHLIGHT_COLORS),
);

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === "string" && VALID_HIGHLIGHT_COLORS.has(value);
}
