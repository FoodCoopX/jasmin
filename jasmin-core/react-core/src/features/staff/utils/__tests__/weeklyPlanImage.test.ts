import { describe, expect, it } from "vitest";

import {
  drawWeeklyPlanImage,
  filledRows,
  layOutWeeklyPlanImage,
  type WeeklyPlanImage,
} from "../weeklyPlanImage";

const ANNA = { label: "Anna", color: "#FFE5E5", absent: false };
const BEN = { label: "Ben", absent: true };
const DAYS = ["MO", "DI", "MI", "DO", "FR", "SA"].map((name, index) => ({
  name,
  date: `0${5 + index}.10.`,
}));

const IMAGE: WeeklyPlanImage = {
  title: "Wochenplan KW 41",
  days: DAYS,
  categories: [
    { name: "Ernte", rows: [[ANNA, null, null, null, null, BEN]] },
    { name: "Packen", rows: [[null, null, null, null, null, null]] },
  ],
};

// Every character is 8 px wide.
const measure = (text: string) => text.length * 8;

/** A 2D context that records what is written where, in which colour. */
function recordingContext() {
  const written: { text: string; fillStyle: string }[] = [];
  const context = {
    fillStyle: "",
    strokeStyle: "",
    font: "",
    textAlign: "left",
    lineWidth: 1,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    measureText: (text: string) => ({ width: measure(text) }),
    fillText(text: string) {
      written.push({ text, fillStyle: context.fillStyle });
    },
  };
  return { context: context as unknown as CanvasRenderingContext2D, written };
}

describe("filledRows", () => {
  it("keeps the rows that hold someone", () => {
    const empty = [null, null];
    expect(filledRows([empty, [ANNA, null], empty], 2)).toEqual([[ANNA, null]]);
  });

  it("keeps one empty row for a category with nobody", () => {
    expect(filledRows([[null, null]], 2)).toEqual([[null, null]]);
    expect(filledRows([], 3)).toEqual([[null, null, null]]);
  });
});

describe("layOutWeeklyPlanImage", () => {
  it("sizes the image to its rows and to the widest texts, within bounds", () => {
    const layout = layOutWeeklyPlanImage(IMAGE, measure, "sans-serif");

    expect(layout.categoryWidth).toBe(100);
    expect(layout.dayWidth).toBe(96);
    expect(layout.width).toBe(2 * 24 + 100 + 6 * 96);
    expect(layout.height).toBe(2 * 24 + 48 + 48 + 2 * 34);
  });

  it("widens the days for a long name, up to a limit", () => {
    const long = { label: "Maximiliane", absent: false };
    const image = {
      ...IMAGE,
      categories: [{ name: "Ernte", rows: [[long]] }],
    };

    expect(layOutWeeklyPlanImage(image, measure, "x").dayWidth).toBe(
      11 * 8 + 24,
    );
    const longer = { label: "M".repeat(40), absent: false };
    expect(
      layOutWeeklyPlanImage(
        { ...IMAGE, categories: [{ name: "Ernte", rows: [[longer]] }] },
        measure,
        "x",
      ).dayWidth,
    ).toBe(200);
  });
});

describe("drawWeeklyPlanImage", () => {
  it("writes the title, the days, the categories and the names", () => {
    const { context, written } = recordingContext();
    const layout = layOutWeeklyPlanImage(IMAGE, measure, "sans-serif");

    drawWeeklyPlanImage(context, IMAGE, layout, "sans-serif");

    const texts = written.map((entry) => entry.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        "Wochenplan KW 41",
        "MO",
        "05.10.",
        "SA",
        "Ernte",
        "Packen",
        "Anna",
        "Ben",
      ]),
    );
  });

  it("writes a shift on an absence in red", () => {
    const { context, written } = recordingContext();
    const layout = layOutWeeklyPlanImage(IMAGE, measure, "sans-serif");

    drawWeeklyPlanImage(context, IMAGE, layout, "sans-serif");

    const colourOf = (text: string) =>
      written.find((entry) => entry.text === text)?.fillStyle;
    expect(colourOf("Ben")).toBe("#c62828");
    expect(colourOf("Anna")).toBe("#1a1a1a");
  });

  it("cuts a name too long for its day with an ellipsis", () => {
    const { context, written } = recordingContext();
    const longer = { label: "M".repeat(40), absent: false };
    const image = { ...IMAGE, categories: [{ name: "Ernte", rows: [[longer]] }] };
    const layout = layOutWeeklyPlanImage(image, measure, "sans-serif");

    drawWeeklyPlanImage(context, image, layout, "sans-serif");

    const cut = written.find((entry) => entry.text.startsWith("MMM"))?.text;
    expect(cut?.endsWith("…")).toBe(true);
    expect(measure(cut ?? "")).toBeLessThanOrEqual(layout.dayWidth - 24);
  });
});
