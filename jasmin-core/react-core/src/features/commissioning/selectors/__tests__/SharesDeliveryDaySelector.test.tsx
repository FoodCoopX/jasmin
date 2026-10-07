/**
 * SharesDeliveryDaySelector: picks one delivery day of a week, or of every
 * delivery day there is when no week is given, and keeps the page's pick one
 * of the days it lists. Rendered inside a small page that holds the pick in
 * state, as the pages do. The generated commissioning client is the mocking
 * boundary: its delivery-days hook is a real TanStack query around a spy that
 * answers from the days the farm runs in each week.
 */

import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SharesDeliveryDay } from "@shared/api/generated/models";
import { flushMicrotasks } from "@/test/profileRenders";

// The canonical mock with one `t` for every render, as react-i18next keeps it.
const i18nMock = vi.hoisted(() => ({
  t: (key: string, fallback?: unknown) => (typeof fallback === "string" ? fallback : key),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: i18nMock.t,
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

vi.mock("@hooks/configuration/useIsMobile", () => ({ useIsMobile: () => false }));

const api = vi.hoisted(() => ({ deliveryDays: vi.fn() }));

vi.mock("@shared/api/generated/commissioning/commissioning", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    useCommissioningSharesDeliveryDaysList: function useDeliveryDaysQuery(params?: unknown) {
      return useQuery({
        queryKey: ["/api/commissioning/shares_delivery_days/", params],
        queryFn: async () => api.deliveryDays(params),
      });
    },
  };
});

import SharesDeliveryDaySelector from "../SharesDeliveryDaySelector";

// ── Fixtures ────────────────────────────────────────────────────────────────

// Backend day numbers: 0 = Monday … 6 = Sunday.
const deliveryDay = (id: string, dayNumber: number): SharesDeliveryDay => ({
  id,
  day_number: dayNumber as SharesDeliveryDay["day_number"],
  valid_from: "2026-01-05",
  valid_until: null,
});

const TUESDAY = deliveryDay("day-tue", 1);
const WEDNESDAY = deliveryDay("day-wed", 2);
const FRIDAY = deliveryDay("day-fri", 4);

// A week's days are the ones running on its Saturday.
const WEEK_41 = "2026-10-10";
const WEEK_42 = "2026-10-17";
const WEEK_43 = "2026-10-24";
// The list of every delivery day is asked for without a date.
const EVERY_DAY = "";

/** The delivery days the farm runs, by the date they are asked for. */
let farm: Record<string, SharesDeliveryDay[]>;

type DaysParams = { active_at_date?: string } | undefined;

const answerFromFarm = async (params: DaysParams) => [
  ...(farm[params?.active_at_date ?? EVERY_DAY] ?? []),
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/** The day the page holds, as of its last render. */
let picked: string | null = null;

type PageProps = { week?: number; initialDay?: string | null };

/** A page that holds the pick in state; without a week it lists every delivery day. */
function Page({ week, initialDay = null }: PageProps) {
  const [day, setDay] = useState<string | null>(initialDay);
  picked = day;
  return (
    <SharesDeliveryDaySelector
      selectedSharesDeliveryDay={day}
      setSelectedSharesDeliveryDay={setDay}
      selectedYear={week ? 2026 : undefined}
      selectedWeek={week}
    />
  );
}

function renderPage(props: PageProps) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const tree = (pageProps: PageProps) => (
    <QueryClientProvider client={queryClient}>
      <Page {...pageProps} />
    </QueryClientProvider>
  );
  const view = render(tree(props));
  return {
    /** The page moves to another week of 2026, keeping its pick. */
    showWeek: (week: number) => view.rerender(tree({ ...props, week })),
  };
}

const DAY = "placeholder.shares_delivery_day_selector";
const NO_DAYS = "commissioning.no_delivery_days_in_week";

const daySelect = () => screen.getByRole("combobox", { name: DAY });

/** The label the day select shows for the pick. */
const shownDay = () =>
  daySelect().closest(".ant-select")?.querySelector(".ant-select-selection-item")?.textContent ?? "";

/** What the day select shows while nothing is picked. */
const placeholderShown = () =>
  daySelect().closest(".ant-select")?.querySelector(".ant-select-selection-placeholder")?.textContent ??
  "";

/** The previous / next arrow beside the day select. */
function arrow(direction: "common.previous" | "common.next") {
  const stepper = daySelect().closest<HTMLElement>(".ant-space");
  if (!stepper) throw new Error("No stepper around the day select");
  return within(stepper).getByRole("button", { name: direction });
}

function openDropdown(): HTMLElement {
  const open = document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
  if (open.length === 0) throw new Error("No select dropdown is open");
  return open[open.length - 1];
}

async function chooseDay(label: string) {
  await userEvent.click(daySelect());
  const option = Array.from(openDropdown().querySelectorAll(".ant-select-item-option-content")).find(
    (content) => content.textContent === label,
  );
  if (!option) throw new Error(`No delivery day ${label}`);
  await userEvent.click(option);
}

/** Lets pending answers arrive and the effects run. */
const settle = () => act(() => flushMicrotasks());

beforeEach(() => {
  picked = null;
  farm = {};
  api.deliveryDays.mockReset().mockImplementation(answerFromFarm);
});

// ── The pick ────────────────────────────────────────────────────────────────

describe("SharesDeliveryDaySelector keeping the pick one of the listed days", () => {
  it("keeps a picked day in every week that lists it and lets it go in a week without delivery days", async () => {
    farm = { [WEEK_41]: [TUESDAY, FRIDAY], [WEEK_42]: [TUESDAY, FRIDAY], [WEEK_43]: [] };
    const page = renderPage({ week: 41 });
    await waitFor(() => expect(shownDay()).toBe("Tuesday, 06.10.2026"));

    await chooseDay("Friday, 09.10.2026");
    await settle();
    expect(picked).toBe(FRIDAY.id);
    expect(shownDay()).toBe("Friday, 09.10.2026");

    page.showWeek(42);
    await waitFor(() => expect(shownDay()).toBe("Friday, 16.10.2026"));
    await settle();
    expect(picked).toBe(FRIDAY.id);

    page.showWeek(43);
    await waitFor(() => expect(picked).toBeNull());
    expect(shownDay()).toBe("");
  });

  it("picks the week's first delivery day while none is picked, also after a week without any", async () => {
    farm = { [WEEK_41]: [TUESDAY, FRIDAY], [WEEK_42]: [], [WEEK_43]: [WEDNESDAY, FRIDAY] };
    const page = renderPage({ week: 41 });

    await waitFor(() => expect(picked).toBe(TUESDAY.id));
    expect(shownDay()).toBe("Tuesday, 06.10.2026");

    page.showWeek(42);
    await waitFor(() => expect(picked).toBeNull());

    page.showWeek(43);
    await waitFor(() => expect(picked).toBe(WEDNESDAY.id));
    expect(shownDay()).toBe("Wednesday, 21.10.2026");
  });

  it("falls back to the week's first day when the pick isn't one of its days, and to none when they fail to load", async () => {
    farm = { [WEEK_41]: [TUESDAY, FRIDAY], [WEEK_42]: [TUESDAY] };
    api.deliveryDays.mockImplementation(async (params: DaysParams) => {
      if (params?.active_at_date === WEEK_43) throw new Error("Network Error");
      return answerFromFarm(params);
    });
    const page = renderPage({ week: 41, initialDay: FRIDAY.id });
    await waitFor(() => expect(shownDay()).toBe("Friday, 09.10.2026"));

    page.showWeek(42);
    await waitFor(() => expect(picked).toBe(TUESDAY.id));
    expect(shownDay()).toBe("Tuesday, 13.10.2026");

    page.showWeek(43);
    await waitFor(() => expect(picked).toBeNull());
    // A list that failed to load doesn't claim the week has no delivery days.
    expect(placeholderShown()).toBe(DAY);
  });
});

// ── No delivery days ────────────────────────────────────────────────────────

describe("SharesDeliveryDaySelector without delivery days", () => {
  it("leaves no day picked in a week without delivery days and says so", async () => {
    farm = { [WEEK_41]: [] };
    renderPage({ week: 41, initialDay: FRIDAY.id });

    await waitFor(() => expect(picked).toBeNull());
    expect(placeholderShown()).toBe(NO_DAYS);
    expect(shownDay()).toBe("");
    expect(arrow("common.previous")).toBeDisabled();
    expect(arrow("common.next")).toBeDisabled();

    await userEvent.click(daySelect());

    expect(within(openDropdown()).getByText(NO_DAYS)).toBeInTheDocument();
  });

  it("clears the pick on a week's empty list, but not on an empty list of every delivery day", async () => {
    farm = { [EVERY_DAY]: [], [WEEK_41]: [] };
    const page = renderPage({ initialDay: FRIDAY.id });

    await waitFor(() => expect(api.deliveryDays).toHaveBeenCalledWith({}));
    await settle();
    expect(picked).toBe(FRIDAY.id);

    page.showWeek(41);

    await waitFor(() => expect(api.deliveryDays).toHaveBeenLastCalledWith({ active_at_date: WEEK_41 }));
    await waitFor(() => expect(picked).toBeNull());
    expect(placeholderShown()).toBe(NO_DAYS);
  });
});

// ── Offline ─────────────────────────────────────────────────────────────────

describe("SharesDeliveryDaySelector while a week's days wait for the network", () => {
  afterEach(() => {
    act(() => onlineManager.setOnline(true));
  });

  it("keeps the pick and says nothing about the week until its days are in", async () => {
    farm = { [WEEK_41]: [TUESDAY, FRIDAY], [WEEK_42]: [TUESDAY, FRIDAY] };
    const page = renderPage({ week: 41 });
    await waitFor(() => expect(shownDay()).toBe("Tuesday, 06.10.2026"));
    await chooseDay("Friday, 09.10.2026");
    await settle();

    act(() => onlineManager.setOnline(false));
    page.showWeek(42);
    await settle();

    expect(api.deliveryDays).not.toHaveBeenCalledWith({ active_at_date: WEEK_42 });
    expect(picked).toBe(FRIDAY.id);
    expect(screen.queryAllByText(NO_DAYS)).toEqual([]);

    act(() => onlineManager.setOnline(true));

    await waitFor(() => expect(shownDay()).toBe("Friday, 16.10.2026"));
    await settle();
    expect(picked).toBe(FRIDAY.id);
    expect(api.deliveryDays.mock.calls).toEqual([[{ active_at_date: WEEK_41 }], [{ active_at_date: WEEK_42 }]]);
  });
});
