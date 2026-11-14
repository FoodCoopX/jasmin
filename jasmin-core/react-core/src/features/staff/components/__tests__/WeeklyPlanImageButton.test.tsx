/**
 * The weekly plan's image button: what it hands the image renderer, and that
 * the PNG reaches the browser as a download.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WeeklyPlanCategoryGrid } from "@shared/api/generated/models";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock();
  return { useTenant: () => tenant };
});

const { renderMock, downloadBlobMock, notifyMock } = vi.hoisted(() => ({
  renderMock: vi.fn(),
  downloadBlobMock: vi.fn(),
  notifyMock: { error: vi.fn() },
}));

vi.mock("@shared/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/utils")>()),
  downloadBlob: downloadBlobMock,
  notify: notifyMock,
}));

vi.mock("@features/staff/utils/weeklyPlanImage", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@features/staff/utils/weeklyPlanImage")
  >()),
  renderWeeklyPlanPng: renderMock,
}));

import WeeklyPlanImageButton from "../WeeklyPlanImageButton";

const HARVEST: WeeklyPlanCategoryGrid = {
  id: "cat-harvest",
  name: "Harvest",
  max_lines: 3,
  rows: [],
};
const PACKING: WeeklyPlanCategoryGrid = {
  id: "cat-packing",
  name: "Packing",
  max_lines: 2,
  rows: [],
};
const ANNA = { label: "Anna", color: "#FFE5E5", absent: false };

/** Anna on the second Harvest line on Monday; nobody else. */
const cellAt = (categoryId: string, rowIndex: number, day: number) =>
  categoryId === HARVEST.id && rowIndex === 1 && day === 0 ? ANNA : null;

function renderButton(disabled = false) {
  render(
    <WeeklyPlanImageButton
      year={2026}
      week={41}
      categories={[HARVEST, PACKING]}
      cellAt={cellAt}
      disabled={disabled}
    />,
  );
  return screen.getByRole("button", { name: /staff\.weekly_plan_png/ });
}

beforeEach(() => {
  renderMock.mockReset().mockResolvedValue(new Blob(["png"]));
  downloadBlobMock.mockReset();
  notifyMock.error.mockReset();
});

describe("WeeklyPlanImageButton", () => {
  it("draws the week's rows that hold someone and downloads the PNG", async () => {
    const user = userEvent.setup();

    await user.click(renderButton());

    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1));
    const image = renderMock.mock.calls[0][0];
    expect(image.title).toBe("staff.weekly_plan_image_title");
    expect(image.days.map((day: { name: string }) => day.name)).toEqual(
      [0, 1, 2, 3, 4, 5].map((day) => `commissioning.weekdays.${day}`),
    );
    expect(image.days[0].date).toContain("05");
    expect(image.categories).toEqual([
      { name: "Harvest", rows: [[ANNA, null, null, null, null, null]] },
      { name: "Packing", rows: [[null, null, null, null, null, null]] },
    ]);
    expect(downloadBlobMock.mock.calls[0][1]).toBe(
      "staff.weekly_staff_plan_2026_commissioning.KW41.png",
    );
  });

  it("says so when the image can't be made", async () => {
    const user = userEvent.setup();
    renderMock.mockRejectedValue(new Error("No 2D canvas"));

    await user.click(renderButton());

    await waitFor(() =>
      expect(notifyMock.error).toHaveBeenCalledWith("common.error_exporting"),
    );
    expect(downloadBlobMock).not.toHaveBeenCalled();
  });

  it("offers nothing to draw for an empty week", () => {
    expect(renderButton(true)).toBeDisabled();
  });
});
