/**
 * ShareWeightsSection: up to four sample weights of each share packed for the
 * delivery day the boxes packing list shows, next to the share size's target
 * weight and the average of the weights taken, recorded inline by the office;
 * plus the CSV export of the average weights over a date range. Rendered
 * through the real EditableTable and CSV export modal, with the week and the
 * delivery day handed in as the packing list does. The generated commissioning
 * client is the mocking boundary: its hooks are real TanStack queries around
 * spies that answer from an in-memory farm, and its update stores the weights
 * the way the backend does, echoing the saved share. The browser download is
 * recorded, not saved.
 *
 * The clock is frozen on Tuesday 6 October 2026 (ISO week 41), before the
 * imports run as well as before every test: the export's date presets read
 * "today".
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Share, SharesDeliveryDay } from "@shared/api/generated/models";
import { makeSharesDeliveryDay } from "@/test/modelFixtures";
import { flushMicrotasks, profileRenders } from "@/test/profileRenders";

const NOW = vi.hoisted(() => {
  const now = new Date(2026, 9, 6, 12, 0);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  return now;
});

// The canonical mock with one `t` for every render, as react-i18next keeps it.
// It appends an interpolated `number`, so the weeks read "… 41", and prints
// the share sizes S, M and L the way every locale does.
const i18nMock = vi.hoisted(() => {
  const sizes: Record<string, string> = {
    "commissioning.S": "S",
    "commissioning.M": "M",
    "commissioning.L": "L",
  };
  return {
    t: (key: string, fallback?: unknown) => {
      if (typeof fallback === "string") return fallback;
      if (key in sizes) return sizes[key];
      const number = (fallback as { number?: unknown } | undefined)?.number;
      return number === undefined ? key : `${key} ${String(number)}`;
    },
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: i18nMock.t,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// Per-test tenant settings; anything unset falls back to the caller's default.
const tenantSettings = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
}));
vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock({
    getSetting: (key: string, defaultValue?: unknown) =>
      key in tenantSettings.values ? tenantSettings.values[key] : defaultValue,
  });
  return { useTenant: () => tenant };
});

const screenSize = vi.hoisted(() => ({ isMobile: false }));
vi.mock("@hooks/configuration/useIsMobile", () => ({
  useIsMobile: () => screenSize.isMobile,
}));

// Inline row editing, the mode a new user starts in.
vi.mock("@shared/contexts/ModalContext", () => ({
  useModal: () => ({ isModalMode: false }),
}));

// ``useRoles`` is real; it reads the roles of the signed-in user from here.
const auth = vi.hoisted(() => ({ roles: ["office"] as string[] }));
vi.mock("@shared/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { roles: auth.roles } }),
}));

const api = vi.hoisted(() => ({
  shares: vi.fn(), update: vi.fn(), exportCsv: vi.fn(),
}));

vi.mock("@shared/api/generated/commissioning/commissioning", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const queryKey = (path: string, params?: unknown) => [
    `/api/commissioning/${path}/`,
    ...(params ? [params] : []),
  ];
  const queryHook = (path: string, request: (params: unknown) => unknown) =>
    function useGeneratedQuery(params?: unknown, options?: { query?: { enabled?: boolean } }) {
      const enabled = options?.query?.enabled;
      return useQuery({ queryKey: queryKey(path, params), queryFn: async () => request(params), enabled });
    };
  return {
    useCommissioningSharesList: queryHook("shares", api.shares),
    getCommissioningSharesListQueryKey: (params?: unknown) => queryKey("shares", params),
    commissioningSharesPartialUpdate: (id: string, share: unknown) => api.update(id, share),
    commissioningSharesExportCsvRetrieve: (params: unknown) => api.exportCsv(params),
  };
});

// The section needs only the share-weights export; the barrel would also load
// every other modal of the app.
vi.mock("@features/commissioning/modals", async () => ({
  ExportCsvShareWeights: (await import("@features/commissioning/modals/csv/ExportCsvShareWeights"))
    .default,
}));

// The files the CSV export saved, in order.
const downloads = vi.hoisted(() => ({ files: [] as string[] }));
vi.mock("@shared/utils/downloadBlob", () => ({
  downloadBlob: (_blob: Blob, filename: string) => downloads.files.push(filename),
}));

import ShareWeightsSection from "../ShareWeightsSection";

// ── Fixtures ────────────────────────────────────────────────────────────────

const deliveryDay = (id: string, dayNumber: number): SharesDeliveryDay => makeSharesDeliveryDay({
  id,
  day_number: dayNumber as SharesDeliveryDay["day_number"],
  valid_from: "2026-01-05",
  valid_until: null,
  number_of_tours: 1,
});

const TUESDAY = deliveryDay("day-tue", 1);
const FRIDAY = deliveryDay("day-fri", 4);

/** A share size: its share type, size and the weight a share of it should have. */
type ShareSize = { shareType: string; size: string; target: string | null };
const VEGETABLES_S: ShareSize = { shareType: "Vegetables", size: "S", target: "2.500" };
const VEGETABLES_M: ShareSize = { shareType: "Vegetables", size: "M", target: "4.000" };
// Fruit has no target weight.
const FRUIT_L: ShareSize = { shareType: "Fruit", size: "L", target: null };

type Weights = [string | null, string | null, string | null, string | null];
const NO_WEIGHTS: Weights = [null, null, null, null];

const share = (
  id: string,
  week: number,
  day: SharesDeliveryDay,
  of: ShareSize,
  weights: Weights = NO_WEIGHTS,
): Share => ({
  id,
  year: 2026,
  delivery_week: week,
  delivery_day: day.id!,
  delivery_day_number: day.day_number,
  share_type_variation: `var-${of.shareType.toLowerCase()}-${of.size}`,
  share_type_name: of.shareType,
  share_type_variation_size: of.size,
  share_type_variation_average_weight: of.target,
  changed_day_number: null,
  harvesting_day: 0,
  washing_day: 0,
  cleaning_day: 1,
  packing_day: 1,
  get_current_stock_day: 1,
  weight1: weights[0],
  weight2: weights[1],
  weight3: weights[2],
  weight4: weights[3],
});

// Tuesday of week 41: the small vegetable share weighed twice, the medium one
// not yet, the fruit share once. Friday and next Tuesday have a small
// vegetable share each.
const SMALL_TUESDAY = share("share-small-tue", 41, TUESDAY, VEGETABLES_S, ["2.450", "2.610", null, null]);
const MEDIUM_TUESDAY = share("share-medium-tue", 41, TUESDAY, VEGETABLES_M);
const FRUIT_TUESDAY = share("share-fruit-tue", 41, TUESDAY, FRUIT_L, ["1.200", null, null, null]);
const SMALL_FRIDAY = share("share-small-fri", 41, FRIDAY, VEGETABLES_S, ["2.380", null, null, null]);
const SMALL_NEXT_TUESDAY = share("share-small-next-tue", 42, TUESDAY, VEGETABLES_S);

const SMALL = "Vegetables S";
const MEDIUM = "Vegetables M";
const FRUIT = "Fruit L";

/** What Friday's small vegetable share shows from its target weight to the average. */
const FRIDAY_SMALL_WEIGHTS = ["2,500 kg", "2,380", "", "", "", "2,38 kg"];

/** What the in-memory farm holds; the request spies answer from it. */
let farm: { shares: Share[] };

type Payload = Record<string, unknown>;
type SharesParams = { year: number; delivery_week: number; delivery_day: string };

/** A weight as the backend's three-decimal field stores it; empty is none. */
const weight = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : Number(value).toFixed(3);

// ── Helpers ─────────────────────────────────────────────────────────────────

type Picked = { week: number; deliveryDayId: string | null };

/** Renders the section for a week and delivery day, Tuesday of week 41 unless
 *  told otherwise; ``show`` hands it another pick, as the packing list does. */
function renderSection(picked: Picked = { week: 41, deliveryDayId: TUESDAY.id! }) {
  const profiler = profileRenders();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const sectionFor = ({ week, deliveryDayId }: Picked) => (
    <QueryClientProvider client={queryClient}>
      {profiler.wrap(<ShareWeightsSection year={2026} week={week} deliveryDayId={deliveryDayId} />)}
    </QueryClientProvider>
  );
  const { rerender } = render(sectionFor(picked));
  return { profiler, show: (next: Picked) => rerender(sectionFor(next)) };
}

const TARGET = "commissioning.target_weight";
const WEIGHT_1 = "commissioning.weight 1";
const WEIGHT_2 = "commissioning.weight 2";
const WEIGHT_3 = "commissioning.weight 3";
const WEIGHT_4 = "commissioning.weight 4";
const AVERAGE = "⌀";
const EXPORT = "commissioning.csv_export_average_weight";
const EXPORT_TITLE = "commissioning.export_share_weights_csv";
const EDIT_OR_DELETE = /table\.(edit|delete)/;

function rowOf(label: string): HTMLElement {
  const row = screen.getByText(label).closest("tr");
  if (!row) throw new Error(`No table row shows ${label}`);
  return row;
}

const bodyRows = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".ant-table-tbody > tr.ant-table-row"));

const headerTexts = () => screen.getAllByRole("columnheader").map((header) => header.textContent ?? "");

/** The cell of a share's row under the column whose header reads ``header``. */
function cellOf(label: string, header: string): HTMLElement {
  const column = headerTexts().indexOf(header);
  if (column < 0) throw new Error(`No column ${header}`);
  return within(rowOf(label)).getAllByRole("cell")[column];
}

/** What a share's row shows from its target weight to the average. */
const weightsOf = (label: string) =>
  [TARGET, WEIGHT_1, WEIGHT_2, WEIGHT_3, WEIGHT_4, AVERAGE].map((header) => cellOf(label, header).textContent);

/** The weight input of the row being edited. */
const weightInput = (header: string) => screen.getByRole("textbox", { name: header });

/** Puts ``text`` in a weight of the row being edited, replacing what it held. */
async function typeWeight(header: string, text: string) {
  await userEvent.clear(weightInput(header));
  if (text) await userEvent.type(weightInput(header), text);
}

const save = () => userEvent.click(screen.getByRole("button", { name: "table.save" }));
const editingDone = () =>
  waitFor(() => expect(screen.queryByRole("button", { name: "table.save" })).not.toBeInTheDocument());

const tableIsBusy = () => document.querySelector('.ant-table-wrapper [aria-busy="true"]') !== null;

/** A request that answers only when the test says so. */
function pending<T>() {
  let answer!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (answer = resolve));
  return { promise, answer };
}

/** An API refusal in the canonical error shape. */
const refusal = (message: string, details: Record<string, unknown> = {}) => ({
  isAxiosError: true,
  message: "Request failed with status code 400",
  response: { status: 400, data: { code: "validation_error", message, details } },
});

const lastSharesRequest = () => api.shares.mock.lastCall?.[0];
const lastUpdate = () => api.update.mock.lastCall?.[1] as Payload | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  tenantSettings.values = {};
  screenSize.isMobile = false;
  auth.roles = ["office"];
  downloads.files = [];
  farm = {
    shares: [SMALL_TUESDAY, MEDIUM_TUESDAY, FRUIT_TUESDAY, SMALL_FRIDAY, SMALL_NEXT_TUESDAY],
  };
  api.shares.mockReset().mockImplementation(async (params: SharesParams) =>
    farm.shares.filter(
      (row) =>
        row.year === params.year &&
        row.delivery_week === params.delivery_week &&
        row.delivery_day === params.delivery_day,
    ),
  );
  // The update answers with the saved share, as the API does.
  api.update.mockReset().mockImplementation(async (id: string, payload: Payload) => {
    const weights = Object.fromEntries(
      ["weight1", "weight2", "weight3", "weight4"]
        .filter((field) => field in payload)
        .map((field) => [field, weight(payload[field])]),
    );
    farm.shares = farm.shares.map((row) => (row.id === id ? { ...row, ...weights } : row));
    return farm.shares.find((row) => row.id === id);
  });
  api.exportCsv.mockReset().mockResolvedValue("week;share;average\r\n41;Vegetables S;2,53\r\n");
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Loading ─────────────────────────────────────────────────────────────────

describe("ShareWeightsSection loading", () => {
  it("lists the shares of the delivery day it is given", async () => {
    renderSection();

    expect(await screen.findByText(SMALL)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "commissioning.share_weights" })).toBeInTheDocument();
    // Physical shares only: the boxes packed and weighed.
    expect(api.shares.mock.calls).toEqual([[{ year: 2026, delivery_week: 41, delivery_day: TUESDAY.id, physical: true }]]);
    // In the server's order.
    expect(screen.getAllByText(/^(Vegetables|Fruit) [SML]$/).map((cell) => cell.textContent)).toEqual([
      SMALL, MEDIUM, FRUIT,
    ]);
    expect(screen.getByText("explainers.share_weights")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: EXPORT })).toBeEnabled();
  });

  it("leaves out the variations packed in bulk in mixed packing, as the boxes list does", async () => {
    tenantSettings.values = { packing_mode: "MIXED" };
    renderSection();

    await screen.findByText(SMALL);
    expect(api.shares.mock.calls).toEqual([
      [{ year: 2026, delivery_week: 41, delivery_day: TUESDAY.id, physical: true, is_packed_bulk: false }],
    ]);
  });

  it("asks for no shares and shows no table without a delivery day", async () => {
    renderSection({ week: 41, deliveryDayId: null });
    await flushMicrotasks();

    expect(api.shares).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "commissioning.share_weights" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: EXPORT })).toBeEnabled();
  });

  it("shows a spinner over the table while the shares load", async () => {
    const rows = pending<Share[]>();
    api.shares.mockImplementation(() => rows.promise);
    renderSection();

    await waitFor(() => expect(tableIsBusy()).toBe(true));
    expect(bodyRows()).toHaveLength(0);

    rows.answer([SMALL_TUESDAY]);

    expect(await screen.findByText(SMALL)).toBeInTheDocument();
    await waitFor(() => expect(tableIsBusy()).toBe(false));
  });
});

// ── Weights ─────────────────────────────────────────────────────────────────

describe("ShareWeightsSection weights", () => {
  it("shows each share's target weight, the weights taken and their average", async () => {
    renderSection();
    await screen.findByText(SMALL);

    expect(headerTexts()).toEqual(
      expect.arrayContaining([TARGET, WEIGHT_1, WEIGHT_2, WEIGHT_3, WEIGHT_4, AVERAGE]),
    );
    // Three decimals for the weights and the target, two for the average; a
    // weight not taken leaves its cell blank.
    expect(weightsOf(SMALL)).toEqual(["2,500 kg", "2,450", "2,610", "", "", "2,53 kg"]);
    expect(weightsOf(MEDIUM)).toEqual(["4,000 kg", "", "", "", "", ""]);
    expect(weightsOf(FRUIT)).toEqual(["", "1,200", "", "", "", "1,20 kg"]);
  });

  it("writes the weights in the farm's number format", async () => {
    tenantSettings.values = { number_locale: "en-US" };
    renderSection();
    await screen.findByText(SMALL);

    expect(weightsOf(SMALL)).toEqual(["2.500 kg", "2.450", "2.610", "", "", "2.53 kg"]);
  });

  it("averages only the weights above zero", async () => {
    farm.shares = [share("share-medium-tue", 41, TUESDAY, VEGETABLES_M, ["3.000", "0.000", "5.000", null])];
    renderSection();
    await screen.findByText(MEDIUM);

    expect(weightsOf(MEDIUM)).toEqual(["4,000 kg", "3,000", "", "5,000", "", "4,00 kg"]);
  });

  it("says there are no shares on a delivery day without any", async () => {
    farm.shares = [];
    renderSection();

    await waitFor(() => expect(api.shares).toHaveBeenCalled());
    expect(await screen.findByText("table.no_data")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(0);
  });
});

// ── Week and day ────────────────────────────────────────────────────────────

describe("ShareWeightsSection following the packing list's week and day", () => {
  it("loads the shares of another delivery day when the pick changes", async () => {
    const { show } = renderSection();
    await screen.findByText(MEDIUM);

    show({ week: 41, deliveryDayId: FRIDAY.id! });

    await waitFor(() => expect(weightsOf(SMALL)).toEqual(FRIDAY_SMALL_WEIGHTS));
    expect(lastSharesRequest()).toEqual({ year: 2026, delivery_week: 41, delivery_day: FRIDAY.id, physical: true });
    expect(screen.queryByText(MEDIUM)).not.toBeInTheDocument();
  });

  it("loads the next week's shares of the same delivery day", async () => {
    const { show } = renderSection();
    await screen.findByText(SMALL);

    show({ week: 42, deliveryDayId: TUESDAY.id! });

    await waitFor(() =>
      expect(lastSharesRequest()).toEqual({ year: 2026, delivery_week: 42, delivery_day: TUESDAY.id, physical: true }),
    );
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(weightsOf(SMALL)).toEqual(["2,500 kg", "", "", "", "", ""]);
    expect(screen.queryByText(MEDIUM)).not.toBeInTheDocument();
  });

  it("records the weights of the delivery day picked", async () => {
    const { show } = renderSection();
    await screen.findByText(MEDIUM);
    show({ week: 41, deliveryDayId: FRIDAY.id! });
    await waitFor(() => expect(weightsOf(SMALL)).toEqual(FRIDAY_SMALL_WEIGHTS));

    await userEvent.click(cellOf(SMALL, WEIGHT_2));
    await typeWeight(WEIGHT_2, "2,42");
    await save();

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(SMALL_FRIDAY.id, expect.objectContaining({ weight2: "2.42" })),
    );
    await editingDone();
    expect(weightsOf(SMALL)).toEqual(["2,500 kg", "2,380", "2,420", "", "", "2,40 kg"]);
  });

  it("drops the table while the packing list has no delivery day", async () => {
    const { show } = renderSection();
    await screen.findByText(SMALL);

    show({ week: 42, deliveryDayId: null });
    await flushMicrotasks();

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(api.shares).not.toHaveBeenCalledWith(expect.objectContaining({ delivery_week: 42 }));
  });
});

// ── Phone ───────────────────────────────────────────────────────────────────

describe("ShareWeightsSection on a phone", () => {
  it("shows the weights without the explainer and the export", async () => {
    screenSize.isMobile = true;
    renderSection();

    expect(await screen.findAllByText(SMALL)).not.toHaveLength(0);
    expect(screen.queryByText("explainers.share_weights")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: EXPORT })).not.toBeInTheDocument();
  });
});

// ── Recording weights ───────────────────────────────────────────────────────

describe("ShareWeightsSection recording weights", () => {
  it("records weights for a share and shows their average as they are typed", async () => {
    renderSection();
    await screen.findByText(MEDIUM);

    await userEvent.click(cellOf(MEDIUM, WEIGHT_1));
    expect(within(rowOf(MEDIUM)).queryByRole("textbox", { name: TARGET })).not.toBeInTheDocument();
    await typeWeight(WEIGHT_1, "4,1");
    await typeWeight(WEIGHT_2, "3,9");
    expect(weightInput(WEIGHT_1)).toHaveValue("4,1");
    await waitFor(() => expect(cellOf(MEDIUM, AVERAGE)).toHaveTextContent("4,00 kg"));
    expect(api.update).not.toHaveBeenCalled();
    await save();

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith(
      MEDIUM_TUESDAY.id,
      expect.objectContaining({ weight1: "4.1", weight2: "3.9" }),
    );
    await editingDone();
    expect(weightsOf(MEDIUM)).toEqual(["4,000 kg", "4,100", "3,900", "", "", "4,00 kg"]);
    // The other shares keep their weights.
    expect(weightsOf(SMALL)).toEqual(["2,500 kg", "2,450", "2,610", "", "", "2,53 kg"]);
  });

  it("starts from the weights taken and saves a corrected one with Enter", async () => {
    renderSection();
    await screen.findByText(SMALL);

    await userEvent.click(cellOf(SMALL, WEIGHT_2));
    expect(weightInput(WEIGHT_1)).toHaveValue("2,450");
    expect(weightInput(WEIGHT_2)).toHaveValue("2,610");
    await userEvent.clear(weightInput(WEIGHT_2));
    await userEvent.type(weightInput(WEIGHT_2), "2,55{Enter}");

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        SMALL_TUESDAY.id,
        expect.objectContaining({ weight1: "2.450", weight2: "2.55" }),
      ),
    );
    await editingDone();
    expect(weightsOf(SMALL)).toEqual(["2,500 kg", "2,450", "2,550", "", "", "2,50 kg"]);
  });

  it("clears a weight and leaves it out of the average", async () => {
    renderSection();
    await screen.findByText(SMALL);

    await userEvent.click(cellOf(SMALL, WEIGHT_2));
    await typeWeight(WEIGHT_2, "");
    await save();

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(lastUpdate()?.weight2 ?? "").toBe("");
    await editingDone();
    expect(weightsOf(SMALL)).toEqual(["2,500 kg", "2,450", "", "", "", "2,45 kg"]);
  });

  it("takes at most three decimals and no letters in a weight", async () => {
    renderSection();
    await screen.findByText(MEDIUM);

    await userEvent.click(cellOf(MEDIUM, WEIGHT_3));
    await typeWeight(WEIGHT_3, "4,1256kg");

    expect(weightInput(WEIGHT_3)).toHaveValue("4,125");
  });

  it("keeps the row open with the server's reason when a save is refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reason = "Ensure that there are no more than 7 digits before the decimal point.";
    api.update.mockRejectedValueOnce(refusal(reason, { weight1: [reason] }));
    renderSection();
    await screen.findByText(MEDIUM);

    await userEvent.click(cellOf(MEDIUM, WEIGHT_1));
    await typeWeight(WEIGHT_1, "41000000");
    await save();

    expect(await screen.findByText(`${WEIGHT_1}: ${reason} — table.save_failed_hint`)).toBeInTheDocument();
    expect(screen.getByText("table.save_failed_title")).toBeInTheDocument();
    expect(weightInput(WEIGHT_1)).toHaveValue("41000000");

    await typeWeight(WEIGHT_1, "4,1");
    await save();

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
    expect(lastUpdate()).toMatchObject({ weight1: "4.1" });
    await editingDone();
    expect(cellOf(MEDIUM, WEIGHT_1)).toHaveTextContent("4,100");
    expect(screen.queryByText("table.save_failed_title")).not.toBeInTheDocument();
  });
});

// ── Roles ───────────────────────────────────────────────────────────────────

describe("ShareWeightsSection roles", () => {
  it.each(["office", "admin"])("lets a %s login record weights", async (role) => {
    auth.roles = [role];
    renderSection();
    await screen.findByText(SMALL);

    expect(within(rowOf(SMALL)).getByRole("button", { name: "table.edit" })).toBeEnabled();
    await userEvent.click(cellOf(SMALL, WEIGHT_3));

    expect(weightInput(WEIGHT_3)).toBeInTheDocument();
  });

  it.each(["gardener", "staff", "management"])(
    "shows the weights to a %s login without a way to change them, and lets it export them",
    async (role) => {
      auth.roles = [role];
      renderSection();
      await screen.findByText(SMALL);

      expect(screen.queryByRole("button", { name: EDIT_OR_DELETE })).not.toBeInTheDocument();
      await userEvent.click(cellOf(SMALL, WEIGHT_3));

      expect(screen.queryByRole("textbox", { name: WEIGHT_3 })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "table.save" })).not.toBeInTheDocument();
      expect(weightsOf(SMALL)).toEqual(["2,500 kg", "2,450", "2,610", "", "", "2,53 kg"]);
      expect(screen.getByRole("button", { name: EXPORT })).toBeEnabled();
    },
  );

  it("offers the office no way to add or delete a share", async () => {
    renderSection();
    await screen.findByText(SMALL);

    expect(screen.queryByRole("button", { name: /table\.add_record/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "table.delete" })).not.toBeInTheDocument();
    await userEvent.keyboard("+");

    expect(bodyRows()).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "table.save" })).not.toBeInTheDocument();
  });
});

// ── CSV export ──────────────────────────────────────────────────────────────

describe("ShareWeightsSection CSV export", () => {
  async function openExport() {
    await userEvent.click(screen.getByRole("button", { name: EXPORT }));
    return screen.findByRole("dialog", { name: EXPORT_TITLE });
  }

  const downloadIn = (dialog: HTMLElement) =>
    within(dialog).getByRole("button", { name: /common\.download/ });

  it("downloads the average weights of a date range as a CSV file", async () => {
    renderSection();
    await screen.findByText(SMALL);

    const dialog = await openExport();
    expect(downloadIn(dialog)).toBeDisabled();
    await userEvent.click(within(dialog).getByPlaceholderText("Start date"));
    await userEvent.click(await screen.findByText("common.last_month"));
    await userEvent.click(downloadIn(dialog));

    await waitFor(() => expect(downloads.files).toEqual(["anteilsgewichte_2026-09-01_2026-09-30.csv"]));
    expect(api.exportCsv.mock.calls).toEqual([[{ date_from: "2026-09-01", date_to: "2026-09-30" }]]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: EXPORT_TITLE })).not.toBeInTheDocument());
  });

  it("downloads nothing when the export is cancelled", async () => {
    renderSection();
    await screen.findByText(SMALL);

    const dialog = await openExport();
    await userEvent.click(within(dialog).getByRole("button", { name: "common.cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: EXPORT_TITLE })).not.toBeInTheDocument());
    expect(api.exportCsv).not.toHaveBeenCalled();
    expect(downloads.files).toEqual([]);
  });
});

// ── Render loop ─────────────────────────────────────────────────────────────

describe("ShareWeightsSection render loop", () => {
  it("settles after loading instead of re-rendering in a loop", async () => {
    const { profiler } = renderSection();
    await screen.findByText(SMALL);
    await flushMicrotasks();

    // About 9 commits in a healthy run; a setState-in-render loop makes
    // thousands.
    expect(profiler.onRender.mock.calls.length).toBeLessThan(100);
  });

  it("settles after the pick moves to another day and to none", async () => {
    const { profiler, show } = renderSection();
    await screen.findByText(MEDIUM);
    show({ week: 41, deliveryDayId: FRIDAY.id! });
    await waitFor(() => expect(weightsOf(SMALL)).toEqual(FRIDAY_SMALL_WEIGHTS));

    show({ week: 42, deliveryDayId: null });
    await flushMicrotasks();

    // About 20 commits in a healthy run.
    expect(profiler.onRender.mock.calls.length).toBeLessThan(100);
  });
});
