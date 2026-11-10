import { describe, expect, it } from "vitest";

import { lastDayInRange } from "../validityRange";

describe("lastDayInRange", () => {
  const range = ["2026-01-01", "2026-12-31"] as const;

  it("is the range's end for a record running past it", () => {
    expect(lastDayInRange({ valid_from: "2025-01-06", valid_until: null }, ...range)).toBe(
      "2026-12-31",
    );
  });

  it("is the record's end when it ends inside the range", () => {
    expect(
      lastDayInRange({ valid_from: "2025-01-06", valid_until: "2026-06-28" }, ...range),
    ).toBe("2026-06-28");
  });

  it("is null for a record ended before the range or starting after it", () => {
    expect(
      lastDayInRange({ valid_from: "2025-01-06", valid_until: "2025-12-28" }, ...range),
    ).toBeNull();
    expect(lastDayInRange({ valid_from: "2027-01-04" }, ...range)).toBeNull();
  });
});
