import { describe, expect, it } from "vitest";
import { formatMemberAmount } from "../amountFormat";
import { formatNumber } from "../numberFormat";

const format = (value: number, decimals: number) =>
  formatNumber(value, decimals, "de-DE");

describe("formatMemberAmount", () => {
  it.each([
    [0.5, "KG", "500", "G"],
    [0.333, "KG", "333", "G"],
    [1, "KG", "1", "KG"],
    [1.5, "KG", "1,5", "KG"],
    [1.25, "KG", "1,25", "KG"],
    [2, "PCS", "2", "PCS"],
    [0.5, "BUNCH", "0,5", "BUNCH"],
    [150, "G", "150", "G"],
    [0.5, null, "0,5", null],
  ])("reads %s %s as %s %s", (value, unit, amount, shownUnit) => {
    expect(formatMemberAmount(value, unit, format)).toEqual({
      amount,
      unit: shownUnit,
    });
  });
});
