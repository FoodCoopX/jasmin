import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ createdAt: undefined as string | undefined }));

vi.mock("../useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  return {
    useTenant: () =>
      makeUseTenantMock({
        tenant: state.createdAt ? { created_at: state.createdAt } : {},
      }),
  };
});

import { useTenantYearOptions } from "../useTenantYearOptions";

function years() {
  const { result } = renderHook(() => useTenantYearOptions());
  return {
    creationYear: result.current.tenantCreationYear,
    options: result.current.yearOptions.map((option) => option.value),
  };
}

describe("useTenantYearOptions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2028-06-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    state.createdAt = undefined;
  });

  it("reaches next year however old the tenant is", () => {
    state.createdAt = "2025-03-01T10:00:00Z";

    expect(years()).toEqual({
      creationYear: 2025,
      options: [2025, 2026, 2027, 2028, 2029],
    });
  });

  it("offers at least three years to a tenant created this year", () => {
    state.createdAt = "2028-02-01T10:00:00Z";

    expect(years().options).toEqual([2028, 2029, 2030]);
  });

  it("starts at the current year without a creation date", () => {
    expect(years()).toEqual({
      creationYear: 2028,
      options: [2028, 2029, 2030],
    });
  });
});
