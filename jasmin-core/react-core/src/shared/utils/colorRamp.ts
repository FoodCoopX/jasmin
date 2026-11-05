/** ``hex`` mixed toward white (a positive ``amount``) or black (a negative
 *  one), ``|amount|`` being the share of white or black, in 0–1. */
function mixed(hex: string, amount: number): string {
  const target = amount > 0 ? 255 : 0;
  const share = Math.abs(amount);
  const channels = [1, 3, 5].map((start) =>
    parseInt(hex.slice(start, start + 2), 16),
  );
  return `#${channels
    .map((channel) =>
      Math.round(channel + (target - channel) * share)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * ``count`` shades of ``base`` for an ordered group sharing one colour (the
 * sizes of a share type, say), one hue in steps of lightness, the first shade
 * nearest the surface. On the light theme the shades run from ``base`` to
 * darker, on the dark theme from a little darker than ``base`` to lighter;
 * black and white, which can't go further, run the other way. Five or more
 * shades take a wider span, so neighbours stay apart.
 *
 * The spans keep an ordinal ramp readable for the variation palette's
 * colours, up to five shades, on both themes: lightness runs one way, with at
 * least 0.06 (OKLab) between neighbours, and the end nearest the surface keeps
 * a 2:1 contrast or more.
 */
export function colorRamp(base: string, count: number, isDark: boolean): string[] {
  if (count <= 0) return [];
  const hex = base.toLowerCase();
  if (count === 1) return [hex];
  const wide = count >= 5;
  const [from, to] = isDark
    ? hex === "#ffffff"
      ? [0, -0.6]
      : [-0.3, wide ? 0.75 : 0.6]
    : hex === "#000000"
      ? [0, 0.6]
      : [0, wide ? -0.65 : -0.5];
  return Array.from({ length: count }, (_, index) =>
    mixed(hex, from + (index / (count - 1)) * (to - from)),
  );
}
