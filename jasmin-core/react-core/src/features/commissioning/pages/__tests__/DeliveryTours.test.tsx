/**
 * DeliveryTours: the office plans the tours of one delivery day by placing the
 * day's delivery stations from a palette into tour columns, one station per
 * position. Every placement, move and removal saves the day's whole plan.
 * Rendered through the real delivery-day selector, drag-and-drop grid and
 * station / delivery-day hooks; the grid is driven the way a click or keyboard
 * user drives it (pick a station up, then activate a cell). The generated
 * commissioning client is the mocking boundary: its hooks are real TanStack
 * queries and mutations around spies that answer from an in-memory farm.
 *
 * The clock is frozen on Tuesday 6 October 2026, the date the delivery-day
 * requests carry.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { message } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CommissioningDeliveryStationsListParams,
  CommissioningDeliveryToursListParams,
  CommissioningSharesDeliveryDaysListParams,
  DeliveryStation,
  DeliveryTourResponse,
  DeliveryToursUpdate,
  DeliveryTourUpdate,
  SharesDeliveryDay,
} from "@shared/api/generated/models";
import { flushMicrotasks, profileRenders } from "@/test/profileRenders";

// The canonical mock, with one `t` for every render as react-i18next keeps it,
// and with interpolation values appended to the key, so a tour heading and a
// remove button name their tour and station.
const i18nMock = vi.hoisted(() => ({
  t: (key: string, fallback?: unknown) =>
    typeof fallback === "string"
      ? fallback
      : fallback && typeof fallback === "object"
        ? `${key}(${Object.entries(fallback)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(",")})`
        : key,
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

// The signed-in user's roles, per test.
const auth = vi.hoisted(() => ({ roles: ["office"] as string[] }));
vi.mock("@shared/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { roles: auth.roles }, logout: () => {} }),
}));

const api = vi.hoisted(() => ({
  deliveryDays: vi.fn(),
  stations: vi.fn(),
  tours: vi.fn(),
  saveTours: vi.fn(),
}));

vi.mock("@shared/api/generated/commissioning/commissioning", async () => {
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  const queryHook = (path: string, request: (params: unknown) => unknown) =>
    function useGeneratedQuery(
      params?: unknown,
      options?: { query?: { enabled?: boolean } },
    ) {
      return useQuery({
        queryKey: [`/api/commissioning/${path}/`, ...(params ? [params] : [])],
        queryFn: async () => request(params),
        enabled: options?.query?.enabled,
      });
    };
  return {
    useCommissioningSharesDeliveryDaysList: queryHook(
      "shares_delivery_days",
      api.deliveryDays,
    ),
    useCommissioningDeliveryStationsList: queryHook("delivery_stations", api.stations),
    useCommissioningDeliveryToursList: queryHook("delivery_tours", api.tours),
    useCommissioningDeliveryToursUpdateToursCreate: (options?: {
      mutation?: { onError?: (error: unknown) => void };
    }) =>
      useMutation({
        mutationKey: ["commissioningDeliveryToursUpdateToursCreate"],
        mutationFn: async ({ data }: { data: DeliveryToursUpdate }) => api.saveTours(data),
        onError: options?.mutation?.onError,
      }),
  };
});

import DeliveryTours from "../DeliveryTours";

// ── Fixtures ────────────────────────────────────────────────────────────────

type Day = SharesDeliveryDay & { id: string };
type Station = DeliveryStation & { id: string };

const TODAY = new Date(2026, 9, 6, 12, 0);

// Backend day numbers: 0 = Monday … 6 = Sunday.
const TUESDAY: Day = {
  id: "day-tue", day_number: 1, valid_from: "2026-01-05", valid_until: null, number_of_tours: 2,
};
// Runs until 25 October; its successor takes Friday over from the 26th.
const FRIDAY: Day = {
  id: "day-fri", day_number: 4, valid_from: "2026-01-05", valid_until: "2026-10-25",
  number_of_tours: 3,
};
const NEXT_FRIDAY: Day = {
  id: "day-fri-next", day_number: 4, valid_from: "2026-10-26", valid_until: null,
  number_of_tours: null,
};

const WEEKDAY_KEYS: Record<number, string> = { 1: "delivery.di", 4: "delivery.fr" };
const shownDate = (isoDate: string) => isoDate.split("-").reverse().join(".");
/** What the delivery-day selector shows for a day: its weekday and validity. */
const dayLabel = (day: Day) =>
  `${WEEKDAY_KEYS[day.day_number]}commissioning.valid_from ${shownDate(day.valid_from)}` +
  (day.valid_until ? ` commissioning.valid_until ${shownDate(day.valid_until)}` : "");

const station = (
  id: string,
  shortName: string | null,
  companyName: string | null = null,
): Station => ({ id, short_name: shortName, company_name: companyName, is_active: true });
const MARKET_HALL = station("st-market-hall", "Market Hall");
const BAKERY = station("st-bakery", "Bakery Lindner");
const SCHOOL = station("st-school", "Village School");
const TOWN_HALL = station("st-town-hall", "Town Hall");
// Has no short name, so it goes by its company name.
const ORGANIC_SHOP = station("st-organic-shop", null, "Organic Shop Ltd");
const MILL = station("st-mill", "Old Mill");
const CHURCH = station("st-church", "Church Square");

const nameOf = (of: Station) => of.short_name ?? of.company_name ?? "";

/** A station at a position of a tour, as a plan is stored and saved. */
const at = (position: number, of: Station) => ({ position, delivery_station_id: of.id });

/** Tuesday's saved plan as the grid shows it: per tour, "position station". */
const TUESDAY_SHOWN = [["1 Market Hall", "2 Bakery Lindner"], ["1 Village School"]];

/** What the in-memory farm holds; the request spies answer from it. */
let farm: {
  days: Day[];
  stations: Record<string, Station[]>;
  plans: Record<string, DeliveryTourUpdate[]>;
};

const activeOn = (day: Day, date: string) =>
  day.valid_from <= date && (!day.valid_until || day.valid_until >= date);

/** The delivery days the backend lists: all of them, those running on a date,
 *  or the open-ended ones that only start after it. */
function listedDays({ active_at_date: date, future }: CommissioningSharesDeliveryDaysListParams) {
  const days = !date
    ? farm.days
    : future
      ? farm.days.filter((day) => !day.valid_until && !activeOn(day, date))
      : farm.days.filter((day) => activeOn(day, date));
  return [...days]
    .sort((a, b) => a.day_number - b.day_number || b.valid_from.localeCompare(a.valid_from))
    .map((day) => ({ ...day }));
}

const listedStations = ({ delivery_day, is_active }: CommissioningDeliveryStationsListParams) =>
  (farm.stations[delivery_day ?? ""] ?? [])
    .filter((item) => !is_active || item.is_active)
    .map((item) => ({ ...item }));

const stationName = (id: string) => {
  const found = Object.values(farm.stations)
    .flat()
    .find((item) => item.id === id);
  return found ? nameOf(found) : "";
};

/** A day's saved plan as the backend lists it: tours and stops in order. */
const listedPlan = ({ delivery_day }: CommissioningDeliveryToursListParams): DeliveryTourResponse[] =>
  (farm.plans[delivery_day] ?? [])
    .filter((tour) => tour.positions.length > 0)
    .sort((a, b) => a.tour_number - b.tour_number)
    .map((tour) => ({
      tour_number: tour.tour_number,
      positions: [...tour.positions]
        .sort((a, b) => a.position - b.position)
        .map((stop) => ({
          ...stop,
          delivery_station_name: stationName(stop.delivery_station_id),
          delivery_station_day_id: `${stop.delivery_station_id}_${delivery_day}`,
        })),
    }));

/** Replaces the day's whole plan, as the backend does. */
function savePlan({ delivery_day, tours }: DeliveryToursUpdate) {
  farm.plans = { ...farm.plans, [delivery_day]: tours.map((tour) => ({ ...tour })) };
  return { message: "Tours updated." };
}

const serverError = (text: string) =>
  Object.assign(new Error(text), {
    isAxiosError: true,
    response: { status: 400, data: { code: "validation_error", message: text } },
  });

// ── Helpers ─────────────────────────────────────────────────────────────────

type User = ReturnType<typeof userEvent.setup>;
type Spot = { tour: number; position: number };

const DAY_SELECTOR = "placeholder.shares_delivery_day_selector";
const PALETTE = "commissioning.available_delivery_stations";
const EMPTY_CELL = "commissioning.drop_station_here";

// Stands in for antd's toast, which would otherwise render into the body.
const noToast = () => undefined as never;

function renderPage() {
  const user = userEvent.setup();
  const profiler = profileRenders();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      {profiler.wrap(<DeliveryTours />)}
    </QueryClientProvider>,
  );
  return { user, profiler };
}

/** Lets pending answers arrive and the page's effects run. */
const settle = () => act(() => flushMicrotasks());

/** Answers a held-back request and lets the page take the answer in. */
const answer = (respond: (() => void) | undefined) =>
  act(async () => {
    respond?.();
    await flushMicrotasks();
  });

const lastSave = () => api.saveTours.mock.lastCall?.[0] as DeliveryToursUpdate | undefined;

/** The plan of the one save the page sent. */
async function savedPlan() {
  await waitFor(() => expect(api.saveTours).toHaveBeenCalledTimes(1));
  return lastSave();
}

/** The label the delivery-day selector shows for its current day. */
function selectedDay(): string {
  const select = screen.getByRole("combobox", { name: DAY_SELECTOR }).closest(".ant-select");
  return select?.querySelector(".ant-select-selection-item")?.textContent ?? "";
}

function openDropdown(): HTMLElement {
  const open = Array.from(document.querySelectorAll<HTMLElement>(".ant-select-dropdown")).filter(
    (dropdown) => !dropdown.classList.contains("ant-select-dropdown-hidden"),
  );
  const dropdown = open[open.length - 1];
  if (!dropdown) throw new Error("No select dropdown is open");
  return dropdown;
}

async function chooseDay(user: User, day: Day) {
  await user.click(screen.getByRole("combobox", { name: DAY_SELECTOR }));
  const option = await waitFor(() => {
    const match = Array.from(
      openDropdown().querySelectorAll<HTMLElement>(".ant-select-item-option"),
    ).find((item) => item.textContent === dayLabel(day));
    if (!match) throw new Error(`No option for ${day.id} is offered`);
    return match;
  });
  await user.click(option);
}

const grid = () => screen.getByRole("table");

/** The headings of the tour columns. */
const tourHeadings = () =>
  within(grid())
    .getAllByRole("columnheader")
    .slice(1)
    .map((heading) => heading.textContent);

/** The grid's rows, one per position. */
function positionRows(): HTMLElement[] {
  const [, body] = within(grid()).getAllByRole("rowgroup");
  return within(body).queryAllByRole("row");
}

/** The control in a cell that picks its station up, or puts the picked-up one
 *  there. A row's first cell shows the position number. */
function cellButton(tour: number, position: number): HTMLElement {
  const row = positionRows()[position - 1];
  if (!row) throw new Error(`The grid has no position ${position}`);
  const target = within(row).getAllByRole("cell")[tour];
  if (!target) throw new Error(`The grid has no tour ${tour}`);
  return within(target).getAllByRole("button")[0];
}

const removeButton = (of: Station) =>
  within(grid()).getByRole("button", {
    name: `commissioning.remove_station(station=${nameOf(of)})`,
  });

/** The placed stations as the grid shows them: per tour, "position station". */
function shownTours(): string[][] {
  return tourHeadings().map((_, tourIndex) =>
    positionRows().flatMap((row) => {
      const [position, ...tours] = within(row).getAllByRole("cell");
      const shown = within(tours[tourIndex]).getAllByRole("button")[0].textContent;
      return shown === EMPTY_CELL ? [] : [`${position.textContent} ${shown}`];
    }),
  );
}

function paletteSection(): HTMLElement {
  const section = screen.getByRole("heading", { name: PALETTE }).parentElement;
  if (!section) throw new Error("The station palette is not rendered");
  return section;
}

/** The stations the palette offers, in its order. */
const paletteStations = () =>
  within(paletteSection())
    .queryAllByRole("button")
    .map((chip) => chip.textContent);

const chip = (of: Station) => within(paletteSection()).getByRole("button", { name: nameOf(of) });

/** Picks a station up from the palette and puts it into a cell. */
async function place(user: User, of: Station, to: Spot) {
  await user.click(chip(of));
  await user.click(cellButton(to.tour, to.position));
}

/** Picks up the station in one cell and puts it into another. */
async function move(user: User, from: Spot, to: Spot) {
  await user.click(cellButton(from.tour, from.position));
  await user.click(cellButton(to.tour, to.position));
}

/** Waits until the day's saved plan is on screen. */
async function opened(shown: string[][] = TUESDAY_SHOWN) {
  await waitFor(() => expect(positionRows().length).toBeGreaterThan(0));
  await waitFor(() => expect(shownTours()).toEqual(shown));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
  auth.roles = ["office"];
  farm = {
    days: [TUESDAY, FRIDAY, NEXT_FRIDAY],
    stations: {
      [TUESDAY.id]: [MARKET_HALL, BAKERY, SCHOOL, TOWN_HALL, ORGANIC_SHOP],
      [FRIDAY.id]: [MILL, CHURCH, MARKET_HALL],
      [NEXT_FRIDAY.id]: [MILL, CHURCH],
    },
    plans: {
      [TUESDAY.id]: [
        { tour_number: 1, positions: [at(1, MARKET_HALL), at(2, BAKERY)] },
        { tour_number: 2, positions: [at(1, SCHOOL)] },
      ],
      [FRIDAY.id]: [{ tour_number: 3, positions: [at(2, CHURCH)] }],
    },
  };
  api.deliveryDays.mockReset().mockImplementation(async (params = {}) => listedDays(params));
  api.stations.mockReset().mockImplementation(async (params) => listedStations(params));
  api.tours.mockReset().mockImplementation(async (params) => listedPlan(params));
  api.saveTours.mockReset().mockImplementation(async (body) => savePlan(body));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── Loading ─────────────────────────────────────────────────────────────────

describe("DeliveryTours loading", () => {
  it("opens on the first delivery day running today with its tours, saved plan and free stations", async () => {
    renderPage();

    await opened();
    expect(
      screen.getByRole("heading", { level: 1, name: "commissioning.delivery_tours" }),
    ).toBeInTheDocument();
    expect(api.deliveryDays).toHaveBeenCalledWith({ active_at_date: "2026-10-06" });
    expect(api.deliveryDays).toHaveBeenCalledWith({ active_at_date: "2026-10-06", future: true });
    expect(selectedDay()).toBe(dayLabel(TUESDAY));
    expect(api.stations.mock.calls).toEqual([[{ is_active: true, delivery_day: TUESDAY.id }]]);
    expect(api.tours.mock.calls).toEqual([[{ delivery_day: TUESDAY.id }]]);
    expect(tourHeadings()).toEqual([
      "commissioning.tour_label(number=1)",
      "commissioning.tour_label(number=2)",
    ]);
    // A position for each of the day's five stations, and five to spare.
    expect(positionRows()).toHaveLength(10);
    expect(paletteStations()).toEqual(["Town Hall", "Organic Shop Ltd"]);
    await settle();
    expect(api.saveTours).not.toHaveBeenCalled();
  });

  it.each(["stations", "tours"] as const)(
    "shows the saved plan whichever request answers first: the %s",
    async (first) => {
      const respond: Partial<Record<"stations" | "tours", () => void>> = {};
      api.stations.mockImplementation(
        (params) => new Promise((resolve) => (respond.stations = () => resolve(listedStations(params)))),
      );
      api.tours.mockImplementation(
        (params) => new Promise((resolve) => (respond.tours = () => resolve(listedPlan(params)))),
      );
      renderPage();
      await waitFor(() => expect(Object.keys(respond)).toHaveLength(2));

      await answer(respond[first]);
      await answer(respond[first === "stations" ? "tours" : "stations"]);

      await opened();
      expect(paletteStations()).toEqual(["Town Hall", "Organic Shop Ltd"]);
      await settle();
      expect(api.saveTours).not.toHaveBeenCalled();
    },
  );
});

// ── Choosing a delivery day ─────────────────────────────────────────────────

describe("DeliveryTours choosing a delivery day", () => {
  it("shows another day's tours, saved plan and stations without saving anything", async () => {
    const { user } = renderPage();
    await opened();

    await chooseDay(user, FRIDAY);

    await opened([[], [], ["2 Church Square"]]);
    expect(selectedDay()).toBe(dayLabel(FRIDAY));
    expect(api.stations).toHaveBeenLastCalledWith({ is_active: true, delivery_day: FRIDAY.id });
    expect(api.tours).toHaveBeenLastCalledWith({ delivery_day: FRIDAY.id });
    expect(tourHeadings()).toEqual([
      "commissioning.tour_label(number=1)",
      "commissioning.tour_label(number=2)",
      "commissioning.tour_label(number=3)",
    ]);
    expect(paletteStations()).toEqual(["Old Mill", "Market Hall"]);
    await settle();
    expect(api.saveTours).not.toHaveBeenCalled();
  });

  it("gives a day without a tour count one tour", async () => {
    const { user } = renderPage();
    await opened();

    await chooseDay(user, NEXT_FRIDAY);

    await waitFor(() => expect(tourHeadings()).toEqual(["commissioning.tour_label(number=1)"]));
    await waitFor(() => expect(shownTours()).toEqual([[]]));
    expect(paletteStations()).toEqual(["Old Mill", "Church Square"]);
    await settle();
    expect(api.saveTours).not.toHaveBeenCalled();
  });
});

// ── Placing ─────────────────────────────────────────────────────────────────

describe("DeliveryTours placing stations", () => {
  it("puts a station from the palette into a cell and saves the day's whole plan", async () => {
    const { user } = renderPage();
    await opened();

    await place(user, TOWN_HALL, { tour: 2, position: 3 });

    expect(await savedPlan()).toEqual({
      delivery_day: TUESDAY.id,
      tours: [
        { tour_number: 1, positions: [at(1, MARKET_HALL), at(2, BAKERY)] },
        // Positions are saved as placed, gaps included.
        { tour_number: 2, positions: [at(1, SCHOOL), at(3, TOWN_HALL)] },
      ],
    });
    expect(shownTours()).toEqual([
      ["1 Market Hall", "2 Bakery Lindner"],
      ["1 Village School", "3 Town Hall"],
    ]);
    expect(paletteStations()).toEqual(["Organic Shop Ltd"]);
  });

  it("puts the station it replaces back into the palette", async () => {
    const { user } = renderPage();
    await opened();

    await place(user, ORGANIC_SHOP, { tour: 1, position: 1 });

    expect(await savedPlan()).toEqual({
      delivery_day: TUESDAY.id,
      tours: [
        { tour_number: 1, positions: [at(1, ORGANIC_SHOP), at(2, BAKERY)] },
        { tour_number: 2, positions: [at(1, SCHOOL)] },
      ],
    });
    expect(shownTours()).toEqual([
      ["1 Organic Shop Ltd", "2 Bakery Lindner"],
      ["1 Village School"],
    ]);
    expect(paletteStations()).toEqual(["Market Hall", "Town Hall"]);
  });

  it("places a station with the keyboard", async () => {
    const { user } = renderPage();
    await opened();

    chip(TOWN_HALL).focus();
    await user.keyboard(" ");
    expect(chip(TOWN_HALL)).toHaveAttribute("aria-pressed", "true");
    cellButton(1, 3).focus();
    await user.keyboard("{Enter}");

    expect(await savedPlan()).toEqual({
      delivery_day: TUESDAY.id,
      tours: [
        { tour_number: 1, positions: [at(1, MARKET_HALL), at(2, BAKERY), at(3, TOWN_HALL)] },
        { tour_number: 2, positions: [at(1, SCHOOL)] },
      ],
    });
    expect(paletteStations()).toEqual(["Organic Shop Ltd"]);
  });

  it("shows that the plan is being saved, then that it is saved", async () => {
    let finish: (() => void) | undefined;
    api.saveTours.mockImplementation(
      (body: DeliveryToursUpdate) =>
        new Promise((resolve) => (finish = () => resolve(savePlan(body)))),
    );
    const { user } = renderPage();
    await opened();

    await place(user, TOWN_HALL, { tour: 1, position: 3 });

    expect(await screen.findByText("settings.saving")).toBeInTheDocument();
    await waitFor(() => expect(finish).toBeDefined());
    await answer(finish);
    expect(await screen.findByText("settings.saved")).toBeInTheDocument();
    expect(screen.queryByText("settings.saving")).not.toBeInTheDocument();
  });
});

// ── Moving ──────────────────────────────────────────────────────────────────

describe("DeliveryTours moving stations", () => {
  it("moves a placed station to an empty cell", async () => {
    const { user } = renderPage();
    await opened();

    await user.click(cellButton(1, 1));
    expect(cellButton(1, 1)).toHaveAttribute("aria-pressed", "true");
    await user.click(cellButton(2, 2));

    expect(await savedPlan()).toEqual({
      delivery_day: TUESDAY.id,
      tours: [
        { tour_number: 1, positions: [at(2, BAKERY)] },
        { tour_number: 2, positions: [at(1, SCHOOL), at(2, MARKET_HALL)] },
      ],
    });
    expect(shownTours()).toEqual([["2 Bakery Lindner"], ["1 Village School", "2 Market Hall"]]);
    expect(paletteStations()).toEqual(["Town Hall", "Organic Shop Ltd"]);
  });

  it("swaps two stations when one is moved onto the other", async () => {
    const { user } = renderPage();
    await opened();

    await move(user, { tour: 1, position: 2 }, { tour: 2, position: 1 });

    expect(await savedPlan()).toEqual({
      delivery_day: TUESDAY.id,
      tours: [
        { tour_number: 1, positions: [at(1, MARKET_HALL), at(2, SCHOOL)] },
        { tour_number: 2, positions: [at(1, BAKERY)] },
      ],
    });
    expect(shownTours()).toEqual([["1 Market Hall", "2 Village School"], ["1 Bakery Lindner"]]);
    expect(paletteStations()).toEqual(["Town Hall", "Organic Shop Ltd"]);
  });

  it("leaves a tour out of the saved plan once its last station has moved away", async () => {
    const { user } = renderPage();
    await opened();

    await move(user, { tour: 2, position: 1 }, { tour: 1, position: 3 });

    expect(await savedPlan()).toEqual({
      delivery_day: TUESDAY.id,
      tours: [
        { tour_number: 1, positions: [at(1, MARKET_HALL), at(2, BAKERY), at(3, SCHOOL)] },
      ],
    });
    expect(shownTours()).toEqual([["1 Market Hall", "2 Bakery Lindner", "3 Village School"], []]);
  });

  it("saves nothing when a station is picked up and put back down", async () => {
    const { user } = renderPage();
    await opened();

    await user.click(cellButton(1, 1));
    await user.click(cellButton(1, 1));
    expect(cellButton(1, 1)).not.toHaveAttribute("aria-pressed");
    await user.click(chip(TOWN_HALL));
    await user.click(chip(TOWN_HALL));
    expect(chip(TOWN_HALL)).toHaveAttribute("aria-pressed", "false");
    // With nothing picked up, an empty cell takes nothing.
    await user.click(cellButton(2, 2));

    await settle();
    expect(shownTours()).toEqual(TUESDAY_SHOWN);
    expect(api.saveTours).not.toHaveBeenCalled();
  });
});

// ── Removing ────────────────────────────────────────────────────────────────

describe("DeliveryTours removing stations", () => {
  it("takes a station out of its tour and back into the palette, and saves the plan without it", async () => {
    const { user } = renderPage();
    await opened();

    await user.click(removeButton(BAKERY));

    expect(await savedPlan()).toEqual({
      delivery_day: TUESDAY.id,
      tours: [
        { tour_number: 1, positions: [at(1, MARKET_HALL)] },
        { tour_number: 2, positions: [at(1, SCHOOL)] },
      ],
    });
    expect(shownTours()).toEqual([["1 Market Hall"], ["1 Village School"]]);
    expect(paletteStations()).toEqual(["Bakery Lindner", "Town Hall", "Organic Shop Ltd"]);
  });

  it("saves an empty plan once the last station is removed", async () => {
    farm.plans[TUESDAY.id] = [{ tour_number: 2, positions: [at(4, TOWN_HALL)] }];
    const { user } = renderPage();
    await opened([[], ["4 Town Hall"]]);

    await user.click(removeButton(TOWN_HALL));

    expect(await savedPlan()).toEqual({ delivery_day: TUESDAY.id, tours: [] });
    expect(shownTours()).toEqual([[], []]);
    expect(paletteStations()).toEqual([
      "Market Hall", "Bakery Lindner", "Village School", "Town Hall", "Organic Shop Ltd",
    ]);
  });
});

// ── Refreshing ──────────────────────────────────────────────────────────────

describe("DeliveryTours refreshing", () => {
  it("adds a position without saving when the day gains a station while the page is open", async () => {
    renderPage();
    await opened();
    const positions = positionRows().length;
    farm.stations[TUESDAY.id] = [...farm.stations[TUESDAY.id], MILL];

    // The office comes back to the tab, and the page fetches its data again.
    await act(async () => {
      window.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(positionRows()).toHaveLength(positions + 1));
    expect(paletteStations()).toEqual(["Town Hall", "Organic Shop Ltd", "Old Mill"]);
    expect(shownTours()).toEqual(TUESDAY_SHOWN);
    await settle();
    expect(api.saveTours).not.toHaveBeenCalled();
  });
});

// ── A refused save ──────────────────────────────────────────────────────────

describe("DeliveryTours refused save", () => {
  it("shows the server's message and reloads the plan the server holds", async () => {
    const toast = vi.spyOn(message, "error").mockImplementation(noToast);
    const refusal = "Town Hall is not served on this delivery day.";
    api.saveTours.mockRejectedValue(serverError(refusal));
    const { user } = renderPage();
    await opened();
    // Meanwhile another office user has moved the bakery into the second tour.
    farm.plans[TUESDAY.id] = [
      { tour_number: 1, positions: [at(1, MARKET_HALL)] },
      { tour_number: 2, positions: [at(1, SCHOOL), at(2, BAKERY)] },
    ];

    await place(user, TOWN_HALL, { tour: 1, position: 3 });

    await waitFor(() => expect(toast).toHaveBeenCalledWith(refusal));
    await waitFor(() =>
      expect(shownTours()).toEqual([["1 Market Hall"], ["1 Village School", "2 Bakery Lindner"]]),
    );
    expect(api.tours.mock.calls).toEqual([
      [{ delivery_day: TUESDAY.id }],
      [{ delivery_day: TUESDAY.id }],
    ]);
    expect(paletteStations()).toEqual(["Town Hall", "Organic Shop Ltd"]);
    expect(api.saveTours).toHaveBeenCalledTimes(1);
  });
});

// ── The palette's empty states ──────────────────────────────────────────────

describe("DeliveryTours palette messages", () => {
  it("says no stations are available when the day serves none", async () => {
    farm.stations[TUESDAY.id] = [];
    farm.plans[TUESDAY.id] = [];
    renderPage();

    await waitFor(() => expect(api.tours).toHaveBeenCalledWith({ delivery_day: TUESDAY.id }));
    await settle();
    expect(
      within(paletteSection()).getByText("commissioning.no_stations_available"),
    ).toBeInTheDocument();
    expect(paletteStations()).toEqual([]);
    expect(positionRows()).toHaveLength(0);
  });

  it("says every station is assigned once all are placed, and offers one again once it is removed", async () => {
    const { user } = renderPage();
    await opened();

    await place(user, TOWN_HALL, { tour: 1, position: 3 });
    await place(user, ORGANIC_SHOP, { tour: 2, position: 2 });

    expect(
      within(paletteSection()).getByText("commissioning.all_stations_assigned"),
    ).toBeInTheDocument();
    expect(paletteStations()).toEqual([]);
    // Each change sends the whole plan as it then stands.
    await waitFor(() => expect(api.saveTours).toHaveBeenCalledTimes(2));
    expect(lastSave()).toEqual({
      delivery_day: TUESDAY.id,
      tours: [
        { tour_number: 1, positions: [at(1, MARKET_HALL), at(2, BAKERY), at(3, TOWN_HALL)] },
        { tour_number: 2, positions: [at(1, SCHOOL), at(2, ORGANIC_SHOP)] },
      ],
    });

    await user.click(removeButton(MARKET_HALL));

    expect(paletteStations()).toEqual(["Market Hall"]);
    expect(
      within(paletteSection()).queryByText("commissioning.all_stations_assigned"),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(api.saveTours).toHaveBeenCalledTimes(3));
  });
});

// ── Roles ───────────────────────────────────────────────────────────────────

describe("DeliveryTours roles", () => {
  it.each(["staff", "gardener", "management"])(
    "shows the plan to %s without letting them change it",
    async (role) => {
      auth.roles = [role];
      const { user } = renderPage();
      await opened();
      expect(paletteStations()).toEqual(["Town Hall", "Organic Shop Ltd"]);
      expect(
        within(grid()).queryAllByRole("button", { name: /^commissioning\.remove_station/ }),
      ).toHaveLength(0);

      await place(user, TOWN_HALL, { tour: 1, position: 3 });
      expect(chip(TOWN_HALL)).toHaveAttribute("aria-pressed", "false");
      await move(user, { tour: 1, position: 1 }, { tour: 2, position: 2 });
      expect(cellButton(1, 1)).not.toHaveAttribute("aria-pressed");

      await settle();
      expect(shownTours()).toEqual(TUESDAY_SHOWN);
      expect(api.saveTours).not.toHaveBeenCalled();
    },
  );

  it("lets an admin change the plan like the office", async () => {
    auth.roles = ["admin"];
    const { user } = renderPage();
    await opened();

    await place(user, ORGANIC_SHOP, { tour: 2, position: 2 });

    expect(await savedPlan()).toEqual({
      delivery_day: TUESDAY.id,
      tours: [
        { tour_number: 1, positions: [at(1, MARKET_HALL), at(2, BAKERY)] },
        { tour_number: 2, positions: [at(1, SCHOOL), at(2, ORGANIC_SHOP)] },
      ],
    });
  });
});

// ── Explainer ───────────────────────────────────────────────────────────────

describe("DeliveryTours explainer", () => {
  it("explains how the tours are planned", async () => {
    renderPage();
    await opened();

    expect(screen.getByText("common.info")).toBeInTheDocument();
    expect(screen.getByText("explainers.delivery_tours")).toBeInTheDocument();
  });
});

// ── Render loop ─────────────────────────────────────────────────────────────

describe("DeliveryTours render loop", () => {
  it("settles after loading instead of re-rendering in a loop", async () => {
    const { profiler } = renderPage();
    await opened();
    await flushMicrotasks();

    // A setState-in-render loop makes thousands of commits.
    expect(profiler.onRender.mock.calls.length).toBeLessThan(150);
  });
});
