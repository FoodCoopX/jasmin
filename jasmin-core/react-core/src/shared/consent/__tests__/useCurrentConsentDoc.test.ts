/**
 * ``useCurrentConsentDoc`` picks the version in force today. Publishing the
 * next version ahead of its start date closes the current one the day before
 * and leaves the next one open-ended — the server only accepts a consent to
 * the version in force, so the open-ended one must not be offered yet.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const documentsMock = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("@shared/api/generated/commissioning/commissioning", () => ({
  useCommissioningConsentDocumentsList: () => ({
    data: documentsMock.list,
    isLoading: false,
  }),
}));

import { useCurrentConsentDoc } from "../useCurrentConsentDoc";

const IN_FORCE = {
  id: "contract-v1",
  valid_from: "2026-01-05",
  valid_until: "2026-10-31",
};
const NEXT = { id: "contract-v2", valid_from: "2026-11-01", valid_until: null };

describe("useCurrentConsentDoc", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers the version in force, not the next one published ahead", () => {
    documentsMock.list = [NEXT, IN_FORCE];

    const { result } = renderHook(() =>
      useCurrentConsentDoc("subscription_contract"),
    );

    expect(result.current.doc?.id).toBe("contract-v1");
  });

  it("offers nothing while no version is in force", () => {
    documentsMock.list = [NEXT];

    const { result } = renderHook(() =>
      useCurrentConsentDoc("subscription_contract"),
    );

    expect(result.current.doc).toBeUndefined();
  });
});
