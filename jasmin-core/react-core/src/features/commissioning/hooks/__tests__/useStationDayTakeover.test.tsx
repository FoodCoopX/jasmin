/**
 * useStationDayTakeover: the question the office gets before a new station day
 * takes over its delivery day's open one. Rendered with AntD's real confirm
 * dialog; the translation stub writes the values it is given after the key,
 * so the test can read the dates the question names.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: unknown) =>
      values && typeof values === "object"
        ? `${key}(${Object.entries(values)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(",")})`
        : key,
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

import { useStationDayTakeover } from "../useStationDayTakeover";

// The station runs on Tuesdays since January; its Thursday ended last year.
const STATION_DAYS = [
  { delivery_day: "sdd-tue", valid_from: "2026-01-05", valid_until: null },
  { delivery_day: "sdd-thu", valid_from: "2025-01-06", valid_until: "2025-12-28" },
];
const DELIVERY_DAYS = [
  { id: "sdd-tue", day_number: 1 },
  { id: "sdd-thu", day_number: 3 },
];

function renderSaveButton(newDay: Record<string, unknown>) {
  const answers: boolean[] = [];
  function Harness() {
    const { confirmTakeover, confirmHolder } = useStationDayTakeover(
      STATION_DAYS,
      DELIVERY_DAYS,
    );
    return (
      <>
        {confirmHolder}
        <button
          type="button"
          onClick={async () => answers.push(await confirmTakeover(newDay))}
        >
          Save
        </button>
      </>
    );
  }
  render(<Harness />);
  return { answers };
}

const clickSave = () => userEvent.click(screen.getByRole("button", { name: "Save" }));

describe("useStationDayTakeover", () => {
  it("goes ahead without asking when the delivery day has no open station day", async () => {
    const { answers } = renderSaveButton({ delivery_day: "sdd-thu", valid_from: "2026-10-12" });

    await clickSave();

    await waitFor(() => expect(answers).toEqual([true]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks before taking over the open station day, naming the weekday and the dates", async () => {
    const { answers } = renderSaveButton({ delivery_day: "sdd-tue", valid_from: "2026-10-12" });

    await clickSave();

    expect(await screen.findAllByText("delivery_stations.takeover_title")).not.toHaveLength(0);
    expect(
      screen.getByText(
        "delivery_stations.takeover_text(weekday=common.weekday_tuesday,since=05.01.2026,from=12.10.2026,until=11.10.2026)",
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "delivery_stations.takeover_confirm" }),
    );

    await waitFor(() => expect(answers).toEqual([true]));
  });

  it("keeps the open station day when the office declines", async () => {
    const { answers } = renderSaveButton({ delivery_day: "sdd-tue", valid_from: "2026-10-12" });

    await clickSave();
    await userEvent.click(await screen.findByRole("button", { name: "common.cancel" }));

    await waitFor(() => expect(answers).toEqual([false]));
  });

  it("leaves a start on or before the open station day's to the period rule", async () => {
    // Such a day overlaps the open one; the table refuses it before saving.
    const { answers } = renderSaveButton({ delivery_day: "sdd-tue", valid_from: "2026-01-05" });

    await clickSave();

    await waitFor(() => expect(answers).toEqual([true]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
