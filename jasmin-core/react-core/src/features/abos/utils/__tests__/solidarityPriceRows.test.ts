import { describe, expect, it } from "vitest";

import type { ShareTypeVariation } from "@shared/api/generated/models";
import { buildSolidarityPriceRows } from "../solidarityPriceRows";

const variation = (
  id: string,
  validFrom: string,
  validUntil: string | null = null,
): ShareTypeVariation =>
  ({ id, size: "M", valid_from: validFrom, valid_until: validUntil }) as ShareTypeVariation;

// Every size's reference price is 20.00 until 2026-06-28 and 22.00 from then.
const referencePriceOn = (_: ShareTypeVariation, date: string | null) =>
  date && date <= "2026-06-28" ? "20.00" : "22.00";

const build = (variations: ShareTypeVariation[], range: [string, string] | null) =>
  buildSolidarityPriceRows(variations, {
    range,
    paidPricesByVariation: new Map([["v-old", [18, 24]]]),
    referencePriceOn,
    nameOf: (each) => String(each.id),
  });

describe("buildSolidarityPriceRows", () => {
  it("lists the sizes running in the range, at their price on their last day in it", () => {
    const rows = build(
      [
        variation("v-ended", "2025-01-06", "2025-12-28"),
        variation("v-old", "2025-01-06", "2026-06-28"),
        variation("v-new", "2026-06-29"),
        variation("v-later", "2027-01-04"),
      ],
      ["2026-01-01", "2026-12-31"],
    );

    expect(rows).toEqual([
      { id: "v-old", name: "v-old", reference: 20, avg: 21, count: 2 },
      { id: "v-new", name: "v-new", reference: 22, avg: null, count: 0 },
    ]);
  });

  it("lists every size at today's price without a range", () => {
    const rows = build([variation("v-ended", "2025-01-06", "2025-12-28")], null);

    expect(rows).toEqual([{ id: "v-ended", name: "v-ended", reference: 22, avg: null, count: 0 }]);
  });
});
