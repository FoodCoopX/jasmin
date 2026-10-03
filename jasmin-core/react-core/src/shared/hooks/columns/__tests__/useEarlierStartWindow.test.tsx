/**
 * ``useEarlierStartWindow``: in onboarding mode a saved row's start may move
 * back to the day after its previous version ended, or to its parent's start
 * when that is later. New rows, and every row outside onboarding mode, get no
 * window.
 */
import { renderHook } from "@testing-library/react";
import dayjs from "dayjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ onboardingMode: true }));

vi.mock("@shared/hooks/configuration/useOnboardingMode", () => ({
  useOnboardingMode: () => state.onboardingMode,
}));

import { useEarlierStartWindow } from "../useEarlierStartWindow";

type Row = {
  key: string | number;
  id?: string;
  weekday: number;
  valid_from?: string;
  valid_until?: string | null;
};

const rows: Row[] = [
  // The previous version of row "current".
  { key: "old", id: "old", weekday: 2, valid_from: "2025-01-06", valid_until: "2025-12-28" },
  { key: "current", id: "current", weekday: 2, valid_from: "2026-03-02", valid_until: null },
  // Another weekday: not a version of "current".
  { key: "other", id: "other", weekday: 3, valid_from: "2025-06-02", valid_until: "2026-02-22" },
];

const sameWeekday = (a: Row, b: Row) => a.weekday === b.weekday;

function windowFor(
  record: Record<string, unknown>,
  options: { parentStart?: (row: Row) => string | undefined; laterAllowed?: (row: Row) => boolean } = {},
) {
  const { result } = renderHook(() =>
    useEarlierStartWindow({ rows, sameLineage: sameWeekday, ...options }),
  );
  return result.current({ key: "current", ...record });
}

beforeEach(() => {
  state.onboardingMode = true;
});

describe("useEarlierStartWindow", () => {
  it("floors a saved row at the day after its previous version ended", () => {
    const moveWindow = windowFor({ id: "current" });

    expect(moveWindow?.savedStart.isSame(dayjs("2026-03-02"), "day")).toBe(true);
    expect(moveWindow?.floor?.isSame(dayjs("2025-12-29"), "day")).toBe(true);
    expect(moveWindow?.laterAllowed).toBe(false);
  });

  it("takes the saved start, not the one being edited", () => {
    const moveWindow = windowFor({ id: "current", valid_from: "2026-01-05" });

    expect(moveWindow?.savedStart.isSame(dayjs("2026-03-02"), "day")).toBe(true);
  });

  it("floors at the parent's start when that is later", () => {
    const moveWindow = windowFor(
      { id: "current" },
      { parentStart: () => "2026-02-02" },
    );

    expect(moveWindow?.floor?.isSame(dayjs("2026-02-02"), "day")).toBe(true);
  });

  it("has no floor without an earlier version or parent", () => {
    const moveWindow = windowFor({ key: "other", id: "other" });

    expect(moveWindow?.floor).toBeNull();
  });

  it("passes on whether the row may also move later", () => {
    const moveWindow = windowFor({ id: "current" }, { laterAllowed: () => true });

    expect(moveWindow?.laterAllowed).toBe(true);
  });

  it("gives a new row no window", () => {
    expect(windowFor({ key: -1 })).toBeNull();
  });

  it("gives no window outside onboarding mode", () => {
    state.onboardingMode = false;

    expect(windowFor({ id: "current" })).toBeNull();
  });
});
