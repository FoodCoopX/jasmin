import { describe, expect, it } from "vitest";
import { hasTierPrice, pickTierPrice, pickTierPriceFromAmount } from "../tierPrice";

const PRICES = { price_1: "2.00", price_2: "1.80", price_3: "1.60" };

describe("pickTierPrice", () => {
  it("picks the highest tier the PU count reaches", () => {
    expect(pickTierPrice(1, PRICES, [1, 5, 10])).toBe(2);
    expect(pickTierPrice(5, PRICES, [1, 5, 10])).toBe(1.8);
    expect(pickTierPrice(12, PRICES, [1, 5, 10])).toBe(1.6);
  });

  it("falls back to a lower tier when a higher one has no price", () => {
    expect(pickTierPrice(12, { ...PRICES, price_3: "" }, [1, 5, 10])).toBe(1.8);
  });

  it("reads prices typed with a decimal comma", () => {
    expect(pickTierPrice(1, { price_1: "2,40" })).toBe(2.4);
  });
});

describe("pickTierPriceFromAmount", () => {
  it("converts the amount to PU before picking", () => {
    expect(pickTierPriceFromAmount("10", "2", PRICES, [1, 5, 10])).toBe(1.8);
  });

  it("reads an amount typed with a decimal comma", () => {
    expect(pickTierPriceFromAmount("5,5", "1", PRICES, [1, 5, 10])).toBe(1.8);
  });
});

describe("hasTierPrice", () => {
  it("is true when any tier holds a price", () => {
    expect(hasTierPrice({ price_2: "1.80" })).toBe(true);
  });

  it("is false for missing or zero prices", () => {
    expect(hasTierPrice({})).toBe(false);
    expect(hasTierPrice({ price_1: 0, price_2: null, price_3: "0.00" })).toBe(false);
  });
});
