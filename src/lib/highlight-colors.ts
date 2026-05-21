// Shared color palette for highlights — same values used by the reader
// popover, the rendered annotation, and any future highlight list view.
//
// Colors are intentionally soft (40% alpha) so they overlay book text
// without losing legibility. Names map 1:1 to the validated color values
// the /api/highlights routes accept.

export type HighlightColor = "yellow" | "green" | "blue" | "pink";

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
};

export const HIGHLIGHT_ORDER: HighlightColor[] = [
  "yellow",
  "green",
  "blue",
  "pink",
];
