// Tag colors of the email log statuses, including the neutral color of a send
// suppressed in onboarding mode and the warning of one held back by the
// tenant's hourly limit.

import { describe, expect, it } from "vitest";

import { getEmailStatusColor } from "../emailStatusColors";

describe("getEmailStatusColor", () => {
  it.each([
    ["failed", "red"],
    ["pending", "orange"],
    ["rate_limited", "orange"],
    ["sent", "blue"],
    ["suppressed", "default"],
  ])("colors %s as %s", (status, color) => {
    expect(getEmailStatusColor(status)).toBe(color);
  });
});
