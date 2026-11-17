import { describe, expect, it } from "vitest";
import type { StationContentsShare } from "@shared/api/generated/models";
import { buildStationContentsCards, marksPackingKind } from "../stationContents";

const share = (
  overrides: Partial<StationContentsShare> = {},
): StationContentsShare => ({
  variation_id: "var-veg-m",
  size: "M",
  share_type_id: "st-veg",
  share_type_name: "Vegetables",
  is_packed_bulk: false,
  items: [
    {
      id: "row-bread",
      share_article_id: "sa-bread",
      share_article_name: "Bread",
      amount: "1.000",
      unit: "PCS",
      size: "M",
      note: "",
      seller_name_for_member_pages: "",
      organic_status: "organic",
    },
    {
      id: "row-carrots",
      share_article_id: "sa-carrots",
      share_article_name: "Carrots",
      amount: "0.750",
      unit: "KG",
      size: "M",
      note: "",
      seller_name_for_member_pages: "",
      organic_status: "conventional",
    },
    {
      id: "row-leek",
      share_article_id: "sa-leek",
      share_article_name: "Leek Zukauf",
      amount: "2.000",
      unit: "PCS",
      size: "M",
      note: "",
      seller_name_for_member_pages: "Gärtnerei Moser",
      organic_status: "in_conversion",
    },
  ],
  ...overrides,
});

const labels = (overrides = {}) => ({
  tints: { "st-veg": 2 },
  marksOrganic: true,
  showsSellers: true,
  articleName: (name: string) => name.replace(" Zukauf", ""),
  shareSizeLabel: (size: string) => `size ${size}`,
  articleSizeLabel: (size: string) => `article ${size}`,
  unitLabel: (unit: string) => unit.toLowerCase(),
  format: (value: number, decimals: number) => value.toFixed(decimals),
  ...overrides,
});

describe("buildStationContentsCards", () => {
  it("marks organic and in-conversion articles where the farm is certified", () => {
    const [card] = buildStationContentsCards([share()], labels());

    expect(card.lines.map((line) => [line.name, line.organicStatus])).toEqual([
      ["Bread", "organic"],
      ["Carrots", null],
      ["Leek", "in_conversion"],
    ]);
  });

  it("names a bought-in article as members read it, with its seller where the farm shows sellers", () => {
    const [shown] = buildStationContentsCards([share()], labels());
    const [hidden] = buildStationContentsCards(
      [share()],
      labels({ showsSellers: false }),
    );

    expect(shown.lines[2]).toMatchObject({
      name: "Leek",
      sellerName: "Gärtnerei Moser",
    });
    expect(hidden.lines[2]).toMatchObject({ name: "Leek", sellerName: "" });
  });

  it("marks nothing organic where the farm has no control number", () => {
    const [card] = buildStationContentsCards(
      [share()],
      labels({ marksOrganic: false }),
    );

    expect(card.lines.every((line) => line.organicStatus === null)).toBe(true);
  });

  it("takes the share type's tint and leaves out the size of a one-size share", () => {
    const [card] = buildStationContentsCards(
      [share({ size: "ONE_SIZE" })],
      labels(),
    );

    expect(card.tint).toBe(2);
    expect(card.sizeLabel).toBe("");
  });
});

describe("packing kind", () => {
  it.each([true, false])(
    "lays a share loose as its own size says (loose=%s), a past week's too",
    (flag) => {
      const [card] = buildStationContentsCards(
        [share({ is_packed_bulk: flag })],
        labels(),
      );

      expect(card.loose).toBe(flag);
    },
  );

  it("is marked only where the farm packs both ways", () => {
    expect(marksPackingKind("MIXED")).toBe(true);
    expect(marksPackingKind("BOXES")).toBe(false);
    expect(marksPackingKind("BULK")).toBe(false);
  });
});
