/**
 * Okabe–Ito colourblind-safe categorical palette, in a fixed order, for the
 * charts that tell share type variations (or their share types) apart.
 * Assigned in a stable order and never cycled until exhausted, so an entity
 * keeps its colour from one chart to the next. A CSA runs a handful of
 * variations, well within these eight steps; ``colorRamp`` shades one of them
 * for an ordered group.
 *
 * Colours rather than CSS variables: the charts write them into SVG attributes.
 */
export const VARIATION_PALETTE = [
  "#0072B2", // blue
  "#CC79A7", // reddish purple
  "#E69F00", // orange
  "#009E73", // green
  "#D55E00", // vermillion
  "#56B4E9", // sky blue
  "#999999", // grey
  "#000000", // black
];

/** The same palette for the dark theme, with white in black's place. */
export const VARIATION_PALETTE_DARK = [
  "#0072B2", // blue
  "#CC79A7", // reddish purple
  "#E69F00", // orange
  "#009E73", // green
  "#D55E00", // vermillion
  "#56B4E9", // sky blue
  "#999999", // grey
  "#FFFFFF", // white
];

/** A variation's name in a chart legend: its share type and its size label,
 *  "Vegetables · S"; either alone when the other is empty. */
export function variationLabel(
  shareTypeName: string | null | undefined,
  sizeLabel: string,
): string {
  return [shareTypeName, sizeLabel].filter(Boolean).join(" · ");
}
