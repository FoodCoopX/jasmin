/**
 * The weekly plan's image: what the page hands the renderer for each cell —
 * the name as the grid shows it, the employee's colour, and an absence.
 */
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  StaffWeeklyPlanGridRetrieveParams,
  WeeklyPlanGrid,
} from "@shared/api/generated/models";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@shared/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", roles: ["office"] } }),
}));

vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock();
  return { useTenant: () => tenant };
});

const { fetchGrid, renderMock, downloadBlobMock } = vi.hoisted(() => ({
  fetchGrid: vi.fn(),
  renderMock: vi.fn(),
  downloadBlobMock: vi.fn(),
}));

vi.mock("@shared/api/generated/staff/staff", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@shared/api/generated/staff/staff")>();
  const { useQuery } = await import("@tanstack/react-query");
  return {
    ...actual,
    useStaffWeeklyPlanGridRetrieve: (
      params: StaffWeeklyPlanGridRetrieveParams,
      options?: { query?: { enabled?: boolean } },
    ) =>
      useQuery({
        queryKey: actual.getStaffWeeklyPlanGridRetrieveQueryKey(params),
        queryFn: (): Promise<WeeklyPlanGrid> => fetchGrid(params),
        ...options?.query,
      }),
  };
});

vi.mock("@features/staff/utils/weeklyPlanImage", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@features/staff/utils/weeklyPlanImage")
  >()),
  renderWeeklyPlanPng: renderMock,
}));

vi.mock("@shared/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/utils")>()),
  downloadBlob: downloadBlobMock,
}));

import {
  ANNA,
  BEN,
  CLARA,
  FRIDAY,
  PACKING,
  PLANNED,
  renderPlan,
  WEDNESDAY,
  weekGrid,
} from "./weeklyStaffPlan.helpers";

beforeEach(() => {
  // A Monday in ISO week 41 of 2026; the page opens on "now".
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 5, 12));
  renderMock.mockReset().mockResolvedValue(new Blob(["png"]));
  downloadBlobMock.mockReset();
  // Anna on Monday; Ben on Wednesday, the day he is away; Clara, deactivated,
  // on Friday's Packing line.
  fetchGrid.mockReset().mockImplementation(
    async (params: StaffWeeklyPlanGridRetrieveParams) =>
      weekGrid({
        ...params,
        assignments: [
          ...PLANNED,
          {
            category_id: PACKING.id,
            row_index: 0,
            day: FRIDAY,
            employee_id: CLARA.id,
          },
        ],
        employees: [ANNA, { ...BEN, absent_days: [WEDNESDAY] }, CLARA],
      }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WeeklyStaffPlan image", () => {
  it("hands the image each cell as the grid shows it", async () => {
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(
      screen.getByRole("button", { name: /staff\.weekly_plan_png/ }),
    );

    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1));
    expect(renderMock.mock.calls[0][0].categories).toEqual([
      {
        name: "Harvest",
        rows: [
          [
            { label: "Anna", color: expect.any(String), absent: false },
            null,
            { label: "Ben", color: undefined, absent: true },
            null,
            null,
            null,
          ],
        ],
      },
      {
        name: "Packing",
        rows: [
          [
            null,
            null,
            null,
            null,
            {
              label: "staff.inactive_employee",
              color: undefined,
              absent: false,
            },
            null,
          ],
        ],
      },
    ]);
  });
});
