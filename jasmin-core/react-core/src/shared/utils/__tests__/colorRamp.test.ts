import { describe, expect, it } from "vitest";

import { colorRamp } from "../colorRamp";

/** Relative luminance, enough to tell which of two shades is lighter. */
const luminance = (hex: string) =>
  [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);

describe("colorRamp", () => {
  it("gives a lone member the base colour and an empty group none", () => {
    expect(colorRamp("#0072B2", 1, false)).toEqual(["#0072b2"]);
    expect(colorRamp("#0072B2", 0, false)).toEqual([]);
  });

  it("darkens from the base on the light theme", () => {
    const shades = colorRamp("#0072B2", 3, false);

    expect(shades[0]).toBe("#0072b2");
    expect(shades).toEqual([...shades].sort((a, b) => luminance(b) - luminance(a)));
    expect(new Set(shades).size).toBe(3);
  });

  it("lightens from a little darker than the base on the dark theme", () => {
    const shades = colorRamp("#E69F00", 4, true);

    expect(luminance(shades[0])).toBeLessThan(luminance("#e69f00"));
    expect(shades).toEqual([...shades].sort((a, b) => luminance(a) - luminance(b)));
  });

  it("runs black lighter and white darker, as neither can go further", () => {
    const black = colorRamp("#000000", 3, false);
    const white = colorRamp("#FFFFFF", 3, true);

    expect(black[0]).toBe("#000000");
    expect(luminance(black[2])).toBeGreaterThan(luminance(black[1]));
    expect(white[0]).toBe("#ffffff");
    expect(luminance(white[2])).toBeLessThan(luminance(white[1]));
  });

  it("keeps the shades of a larger group apart", () => {
    const four = colorRamp("#009E73", 4, false);
    const five = colorRamp("#009E73", 5, false);

    // Five shades reach further than four, rather than crowding the same span.
    expect(luminance(five[4])).toBeLessThan(luminance(four[3]));
  });
});
