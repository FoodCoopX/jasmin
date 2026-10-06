/**
 * LoggingStorage: the stock ledger of one storage (every movement with the
 * running balance it leaves behind) above the internal workflow, the
 * theoretical harvest, clean, wash and purchase amounts of a year. Both tables
 * are read-only. Rendered with the real selectors, column hooks, date-range
 * presets and AntD tables; the generated commissioning client is the mocking
 * boundary, with each list hook a real TanStack query around a spy that
 * answers from an in-memory server.
 *
 * The clock is frozen on Monday 5 October 2026 (ISO week 41), which decides
 * the workflow's default year, the date-range presets and the month the range
 * picker opens on.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CommissioningStorageLoggingListParams,
  CommissioningTheoreticalHarvestsListParams,
  DayNumberEnum,
  ShareArticle,
  Storage,
  StorageLoggingEntry,
  TheoreticalHarvest,
} from "@shared/api/generated/models";
import { flushMicrotasks, profileRenders } from "@/test/profileRenders";
import { makeUseTenantMock, type UseTenantMockShape } from "@/test/tenantMock";

// The page reads the current year once, when its module loads, so the clock is
// frozen before the import as well as around every test.
const NOW = vi.hoisted(() => {
  const now = new Date(2026, 9, 5, 12, 0);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  return now;
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// The tenant of the current test; ``setTenant`` builds it.
const tenantState = vi.hoisted(() => ({
  current: null as UseTenantMockShape | null,
}));
vi.mock("@hooks/configuration/useTenant", () => ({
  useTenant: () => tenantState.current,
}));

const api = vi.hoisted(() => ({
  storages: vi.fn(),
  shareArticles: vi.fn(),
  ledger: vi.fn(),
  harvests: vi.fn(),
  cleanAmounts: vi.fn(),
  washAmounts: vi.fn(),
  purchaseAmounts: vi.fn(),
}));

// Each list hook is a real query whose request is the matching spy.
vi.mock("@shared/api/generated/commissioning/commissioning", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const listHook = (path: string, request: (params: unknown) => Promise<unknown>) =>
    function useList(params: unknown, options?: { query?: { enabled?: boolean } }) {
      return useQuery({
        queryKey: [path, ...(params ? [params] : [])],
        queryFn: () => request(params),
        enabled: options?.query?.enabled,
      });
    };
  return {
    useCommissioningStoragesList: listHook("storages", api.storages),
    useCommissioningShareArticlesList: listHook("share_articles", api.shareArticles),
    useCommissioningStorageLoggingList: listHook("storage_logging", api.ledger),
    useCommissioningTheoreticalHarvestsList: listHook("theoretical_harvests", api.harvests),
    useCommissioningTheoreticalCleanAmountsList: listHook(
      "theoretical_clean_amounts",
      api.cleanAmounts,
    ),
    useCommissioningTheoreticalWashAmountsList: listHook(
      "theoretical_wash_amounts",
      api.washAmounts,
    ),
    useCommissioningTheoreticalPurchaseAmountsList: listHook(
      "theoretical_purchase_amounts",
      api.purchaseAmounts,
    ),
  };
});

import LoggingStorage from "../LoggingStorage";

// ── Fixtures ────────────────────────────────────────────────────────────────

const CELLAR: Storage = { id: "storage-cellar", name: "Cellar", is_active: true };
const COLD_ROOM: Storage = { id: "storage-cold-room", name: "Cold room", is_active: true };

const CARROTS: ShareArticle = { id: "sa-carrots", name: "Carrots", default_movement_unit: "KG" };
const LEEK: ShareArticle = { id: "sa-leek", name: "Leek", default_movement_unit: "PCS" };

/** The ISO year, week and backend day number (0 = Monday) of a date. */
function isoDay(isoDate: string) {
  const date = dayjs(isoDate);
  return {
    year: date.isoWeekYear(),
    delivery_week: date.isoWeek(),
    day_number: (date.isoWeekday() - 1) as DayNumberEnum,
  };
}

/** One ledger row as the backend reports it: the movement's delta and the
 *  balance of its article in this storage after it. */
function movement(
  id: string,
  type: string,
  isoDate: string,
  article: ShareArticle,
  amount: number,
  runningBalance: number,
  storage: Storage = CELLAR,
): StorageLoggingEntry {
  return {
    id,
    date: `${isoDate}T12:00:00+02:00`,
    type,
    share_article: article.id!,
    share_article_name: article.name,
    amount,
    unit: article.default_movement_unit,
    size: "M",
    ...isoDay(isoDate),
    storage_name: storage.name,
    running_balance: runningBalance,
  };
}

// The cellar's ledger, oldest first. Carrots: harvested, a zero-amount waste
// booking, packed into shares, counted (a correction of -2.5) and sold to a
// reseller beyond what was in stock. Leek: bought in.
const CELLAR_LEDGER: StorageLoggingEntry[] = [
  movement("mv-harvest", "HARVEST", "2026-09-28", CARROTS, 25, 25),
  movement("mv-purchase", "PURCHASE", "2026-09-29", LEEK, 40, 40),
  movement("mv-waste", "WASTE", "2026-09-30", CARROTS, 0, 25),
  movement("mv-shares", "SHARECONTENT", "2026-10-01", CARROTS, -10, 15),
  movement("mv-count", "INVENTORY", "2026-10-02", CARROTS, -2.5, 12.5),
  movement("mv-order", "ORDERCONTENT", "2026-10-05", CARROTS, -14, -1.5),
];

const COLD_ROOM_LEDGER: StorageLoggingEntry[] = [
  movement("mv-cold-harvest", "HARVEST", "2026-09-30", LEEK, 8, 8, COLD_ROOM),
];

/** One theoretical amount; the four workflow sources share this shape. */
function theoretical(
  id: string,
  isoDate: string,
  article: ShareArticle,
  amount: string | null,
  links: Pick<TheoreticalHarvest, "share_content" | "order_content"> = {},
): TheoreticalHarvest {
  return {
    id,
    ...isoDay(isoDate),
    amount,
    unit: article.default_movement_unit,
    size: "M",
    share_article: article.id!,
    share_article_name: article.name,
    storage: CELLAR.id!,
    share_content: null,
    order_content: null,
    ...links,
  };
}

const HARVESTS: TheoreticalHarvest[] = [
  theoretical("th-carrots", "2026-09-29", CARROTS, "25.00", { share_content: "sc-1" }),
  theoretical("th-leek", "2026-10-05", LEEK, "40.00", { order_content: "oc-1" }),
  theoretical("th-zero", "2026-09-23", CARROTS, "0.00"),
  theoretical("th-open", "2026-09-17", CARROTS, null),
  theoretical("th-next-year", "2027-01-11", LEEK, "12.00"),
];
const CLEAN_AMOUNTS = [theoretical("tc-carrots", "2026-09-30", CARROTS, "18.00")];
const WASH_AMOUNTS = [theoretical("tw-carrots", "2026-10-01", CARROTS, "7.50")];
const PURCHASE_AMOUNTS = [theoretical("tp-leek", "2026-10-06", LEEK, "30.00")];

// What the server currently holds; the list requests answer from it.
let server: {
  storages: Storage[];
  shareArticles: ShareArticle[];
  ledgers: Record<string, StorageLoggingEntry[]>;
  harvests: TheoreticalHarvest[];
  cleanAmounts: TheoreticalHarvest[];
  washAmounts: TheoreticalHarvest[];
  purchaseAmounts: TheoreticalHarvest[];
};

/** The ledger request, answered newest first and filtered like the backend. */
function answerLedger({
  storage,
  share_article,
  start_date,
  end_date,
}: CommissioningStorageLoggingListParams) {
  return [...(server.ledgers[storage] ?? [])]
    .reverse()
    .filter((entry) => !share_article || entry.share_article === share_article)
    .filter((entry) => !start_date || entry.date.slice(0, 10) >= start_date)
    .filter((entry) => !end_date || entry.date.slice(0, 10) <= end_date);
}

/** A workflow request, filtered by year and article like the backend. */
const answerWorkflow =
  (rows: () => TheoreticalHarvest[]) =>
  async ({ year, share_article }: CommissioningTheoreticalHarvestsListParams) =>
    rows()
      .filter((row) => row.year === year)
      .filter((row) => !share_article || row.share_article === share_article);

function setTenant(settings: Record<string, unknown> = {}) {
  const getSetting = (key: string, defaultValue?: unknown) =>
    key in settings ? settings[key] : defaultValue;
  tenantState.current = makeUseTenantMock({ getSetting, getCurrentSetting: getSetting });
}

/** A response the test sends when it chooses to. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function renderPage() {
  const profiler = profileRenders();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      {profiler.wrap(<LoggingStorage />)}
    </QueryClientProvider>,
  );
  return { profiler };
}

/** The page has two sections: the storage ledger, then the theoretical
 *  amounts below the "internal workflow" heading. */
function isInLedgerSection(element: HTMLElement): boolean {
  const workflowHeading = screen.getByRole("heading", {
    name: "commissioning.internal_workflow",
  });
  return Boolean(
    element.compareDocumentPosition(workflowHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function inLedgerSection(elements: HTMLElement[]): HTMLElement {
  const found = elements.find(isInLedgerSection);
  if (!found) throw new Error("Not shown in the ledger section");
  return found;
}

function inWorkflowSection(elements: HTMLElement[]): HTMLElement {
  const found = elements.find((element) => !isInLedgerSection(element));
  if (!found) throw new Error("Not shown in the workflow section");
  return found;
}

const ledgerTable = () => inLedgerSection(screen.getAllByRole("table"));
const workflowTable = () => inWorkflowSection(screen.getAllByRole("table"));
const queryLedgerTable = () => screen.queryAllByRole("table").find(isInLedgerSection) ?? null;

/** The visible text of every cell, row by row. */
function rowsOf(table: HTMLElement): string[][] {
  return Array.from(table.querySelectorAll<HTMLElement>("tbody > tr.ant-table-row")).map(
    (row) =>
      Array.from(row.querySelectorAll<HTMLElement>("td")).map((cell) => cell.textContent ?? ""),
  );
}

const ledgerRows = () => rowsOf(ledgerTable());
const workflowRows = () => rowsOf(workflowTable());

/** Whether the table's loading spinner is showing. AntD's Spin turns itself
 *  off in an effect, a render after the rows arrive, so wait for it to go. */
const isLoading = (table: HTMLElement) =>
  Boolean(table.closest(".ant-table-wrapper")?.querySelector(".ant-spin-spinning"));

const storageSelect = () =>
  screen.getByRole("combobox", { name: "placeholder.storage_selector" });

/** The spinner the storage select shows in place of its (aria-hidden) arrow
 *  while the storages load. */
const storageSpinner = () =>
  within(storageSelect().closest(".ant-select") as HTMLElement).queryByRole("img", {
    name: "loading",
    hidden: true,
  });

async function storagesSettled() {
  await waitFor(() => expect(storageSpinner()).toBeNull());
}

const articleSelects = () =>
  screen.getAllByRole("combobox", { name: "placeholder.share_article_selector" });
const hideSwitches = () =>
  screen.getAllByRole("switch", { name: "commissioning.hide_inactive_rows" });
const ledgerArticleSelect = () => inLedgerSection(articleSelects());
const workflowArticleSelect = () => inWorkflowSection(articleSelects());
const ledgerHideSwitch = () => inLedgerSection(hideSwitches());
const workflowHideSwitch = () => inWorkflowSection(hideSwitches());
const sourceButton = (label: string) => screen.getByRole("button", { name: label });

/** Opens an AntD select and picks the option with this label. */
async function chooseOption(combobox: HTMLElement, label: string) {
  await userEvent.click(combobox);
  const option = await waitFor(() => {
    const match = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
      ),
    ).find((candidate) => candidate.textContent === label);
    if (!match) throw new Error(`No option "${label}" is offered`);
    return match;
  });
  await userEvent.click(option);
}

/** The range picker's dropdown open right now; a closed one stays in the DOM. */
function openPickerDropdown(): HTMLElement {
  const open = Array.from(
    document.querySelectorAll<HTMLElement>(".ant-picker-dropdown"),
  ).filter((dropdown) => !dropdown.classList.contains("ant-picker-dropdown-hidden"));
  const dropdown = open[open.length - 1];
  if (!dropdown) throw new Error("No date picker is open");
  return dropdown;
}

async function pickDateRange(startIsoDate: string, endIsoDate: string) {
  await userEvent.click(screen.getByPlaceholderText("common.start_date"));
  for (const isoDate of [startIsoDate, endIsoDate]) {
    const cell = openPickerDropdown().querySelector<HTMLElement>(`td[title="${isoDate}"]`);
    if (!cell) throw new Error(`No calendar cell for ${isoDate}`);
    await userEvent.click(cell);
  }
}

const lastLedgerRequest = () => api.ledger.mock.lastCall?.[0];

const KG = "commissioning.units.kg";
const PCS = "commissioning.units.pcs";

// The cellar ledger's rows: date, kind, article, change, balance and unit.
const CELLAR_ROWS = {
  order: ["05.10.2026", "common.order_content", "Carrots", "-14,00", "-1,50", KG],
  count: ["02.10.2026", "common.inventory", "Carrots", "-2,50", "12,50", KG],
  shares: ["01.10.2026", "common.share_content", "Carrots", "-10,00", "15,00", KG],
  waste: ["30.09.2026", "common.waste", "Carrots", "0,00", "25,00", KG],
  purchase: ["29.09.2026", "common.purchase", "Leek", "+40,00", "40,00", PCS],
  harvest: ["28.09.2026", "common.harvest", "Carrots", "+25,00", "25,00", KG],
};

// This year's theoretical harvests: date, linked content, article, amount and unit.
const HARVEST_ROWS = {
  leek: ["05.10.2026", "common.order_content", "Leek", "40,00", PCS],
  carrots: ["29.09.2026", "common.share_content", "Carrots", "25,00", KG],
  zero: ["23.09.2026", "", "Carrots", "0,00", KG],
  open: ["17.09.2026", "", "Carrots", "-", KG],
};

async function cellarLedgerShown() {
  await waitFor(() => expect(ledgerRows()).toHaveLength(5));
}

async function harvestsShown() {
  await waitFor(() => expect(workflowRows()).toHaveLength(3));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setTenant();
  server = {
    storages: [CELLAR, COLD_ROOM],
    shareArticles: [CARROTS, LEEK],
    ledgers: { [CELLAR.id!]: CELLAR_LEDGER, [COLD_ROOM.id!]: COLD_ROOM_LEDGER },
    harvests: HARVESTS,
    cleanAmounts: CLEAN_AMOUNTS,
    washAmounts: WASH_AMOUNTS,
    purchaseAmounts: PURCHASE_AMOUNTS,
  };
  api.storages.mockReset().mockImplementation(async () => server.storages);
  api.shareArticles.mockReset().mockImplementation(async () => server.shareArticles);
  api.ledger.mockReset().mockImplementation(async (params) => answerLedger(params));
  api.harvests.mockReset().mockImplementation(answerWorkflow(() => server.harvests));
  api.cleanAmounts.mockReset().mockImplementation(answerWorkflow(() => server.cleanAmounts));
  api.washAmounts.mockReset().mockImplementation(answerWorkflow(() => server.washAmounts));
  api.purchaseAmounts
    .mockReset()
    .mockImplementation(answerWorkflow(() => server.purchaseAmounts));
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Page ────────────────────────────────────────────────────────────────────

describe("LoggingStorage page", () => {
  it("introduces the storage ledger and the internal workflow and explains both", async () => {
    renderPage();
    await cellarLedgerShown();

    for (const heading of ["commissioning.storage_logging", "commissioning.internal_workflow"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText("commissioning.storage_logging_explanation")).toBeInTheDocument();
    expect(screen.getByText("commissioning.workflow_explanation")).toBeInTheDocument();
    expect(screen.getByText(/explainers\.logging_storage/)).toBeInTheDocument();
    expect(screen.getByText(/explainers\.workflow/)).toBeInTheDocument();
  });

  it("only shows what was logged: neither table offers a way to change an entry", async () => {
    renderPage();
    await cellarLedgerShown();
    await harvestsShown();

    for (const table of [ledgerTable(), workflowTable()]) {
      const body = table.querySelector("tbody") as HTMLElement;
      expect(within(body).queryAllByRole("button")).toHaveLength(0);
      expect(within(body).queryAllByRole("textbox")).toHaveLength(0);
      expect(within(body).queryAllByRole("checkbox")).toHaveLength(0);
    }
  });

  it("settles after loading both tables instead of re-rendering in a loop", async () => {
    const { profiler } = renderPage();
    await cellarLedgerShown();
    await harvestsShown();
    await flushMicrotasks();

    // Loading both tables commits about a dozen times; a setState-in-render
    // loop commits thousands.
    expect(profiler.onRender.mock.calls.length).toBeLessThan(130);
  });
});

// ── Storage ledger ──────────────────────────────────────────────────────────

describe("LoggingStorage storage ledger", () => {
  it("asks for no ledger until the storages have loaded, then opens the first one", async () => {
    const storages = deferred<Storage[]>();
    api.storages.mockImplementation(() => storages.promise);
    renderPage();
    await harvestsShown();

    expect(storageSpinner()).toBeInTheDocument();
    expect(api.ledger).not.toHaveBeenCalled();
    expect(queryLedgerTable()).toBeNull();

    storages.resolve([CELLAR, COLD_ROOM]);

    await cellarLedgerShown();
    expect(api.ledger).toHaveBeenCalledTimes(1);
    expect(api.ledger).toHaveBeenCalledWith({ storage: CELLAR.id });
    expect(storageSpinner()).toBeNull();
    expect(
      within(storageSelect().closest(".ant-select") as HTMLElement).getByText("Cellar"),
    ).toBeInTheDocument();
  });

  it("shows a spinner on the ledger until its movements arrive", async () => {
    const ledger = deferred<StorageLoggingEntry[]>();
    api.ledger.mockImplementation(() => ledger.promise);
    renderPage();

    await waitFor(() => expect(api.ledger).toHaveBeenCalled());
    expect(isLoading(ledgerTable())).toBe(true);

    ledger.resolve(answerLedger({ storage: CELLAR.id! }));

    await cellarLedgerShown();
    await waitFor(() => expect(isLoading(ledgerTable())).toBe(false));
  });

  it("lists each movement newest first with its date, kind, article, change, balance and unit", async () => {
    renderPage();
    await cellarLedgerShown();

    const headers = within(ledgerTable())
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual([
      "commissioning.date",
      "",
      "commissioning.share_article_name",
      "commissioning.amount",
      "commissioning.balance",
      "commissioning.unit",
    ]);
    expect(ledgerRows()).toEqual([
      CELLAR_ROWS.order,
      CELLAR_ROWS.count,
      CELLAR_ROWS.shares,
      CELLAR_ROWS.purchase,
      CELLAR_ROWS.harvest,
    ]);
  });

  it("lets the user turn the ledger to oldest first", async () => {
    renderPage();
    await cellarLedgerShown();
    const dateHeader = within(ledgerTable()).getByRole("columnheader", {
      name: /commissioning\.date/,
    });
    expect(dateHeader).toHaveAttribute("aria-sort", "descending");

    // A sorted column cycles through unsorted before it sorts ascending.
    await userEvent.click(dateHeader);
    await userEvent.click(dateHeader);

    expect(dateHeader).toHaveAttribute("aria-sort", "ascending");
    expect(ledgerRows()).toEqual([
      CELLAR_ROWS.harvest,
      CELLAR_ROWS.purchase,
      CELLAR_ROWS.shares,
      CELLAR_ROWS.count,
      CELLAR_ROWS.order,
    ]);
  });

  it("marks stock coming in green, stock going out and a negative balance red", async () => {
    renderPage();
    await cellarLedgerShown();

    expect(screen.getByText("+25,00")).toHaveClass("text-success");
    expect(screen.getByText("-10,00")).toHaveClass("text-error");
    expect(screen.getByText("-1,50")).toHaveClass("text-error");
    expect(screen.getByText("12,50")).not.toHaveClass("text-error");
  });

  it("names every kind of movement", async () => {
    server.ledgers[CELLAR.id!] = [
      movement("mv-1", "HARVEST", "2026-09-21", CARROTS, 1, 1),
      movement("mv-2", "PURCHASE", "2026-09-22", CARROTS, 1, 2),
      movement("mv-3", "WASH", "2026-09-23", CARROTS, 1, 3),
      movement("mv-4", "CLEAN", "2026-09-24", CARROTS, 1, 4),
      movement("mv-5", "SHARECONTENT", "2026-09-25", CARROTS, -1, 3),
      movement("mv-6", "ORDERCONTENT", "2026-09-26", CARROTS, -1, 2),
      movement("mv-7", "WASTE", "2026-09-27", CARROTS, -1, 1),
      movement("mv-8", "INVENTORY", "2026-09-28", CARROTS, 1, 2),
    ];
    renderPage();
    await waitFor(() => expect(ledgerRows()).toHaveLength(8));

    expect(ledgerRows().map((row) => row[1])).toEqual([
      "common.inventory",
      "common.waste",
      "common.order_content",
      "common.share_content",
      "commissioning.cleaned",
      "commissioning.washed",
      "common.purchase",
      "common.harvest",
    ]);
  });

  it("hides movements with an amount of zero until the user asks to see them", async () => {
    renderPage();
    await cellarLedgerShown();
    expect(ledgerHideSwitch()).toBeChecked();
    expect(ledgerRows()).not.toContainEqual(CELLAR_ROWS.waste);

    await userEvent.click(ledgerHideSwitch());

    expect(ledgerRows()).toEqual([
      CELLAR_ROWS.order,
      CELLAR_ROWS.count,
      CELLAR_ROWS.shares,
      CELLAR_ROWS.waste,
      CELLAR_ROWS.purchase,
      CELLAR_ROWS.harvest,
    ]);
    expect(api.ledger).toHaveBeenCalledTimes(1);
  });

  it("filters the movements by kind", async () => {
    renderPage();
    await cellarLedgerShown();

    await userEvent.click(within(ledgerTable()).getByRole("button", { name: "filter" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "common.harvest" }));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() => expect(ledgerRows()).toEqual([CELLAR_ROWS.harvest]));
  });

  it("shows the ledger of the storage the user switches to", async () => {
    renderPage();
    await cellarLedgerShown();

    await chooseOption(storageSelect(), "Cold room");

    await waitFor(() =>
      expect(ledgerRows()).toEqual([
        ["30.09.2026", "common.harvest", "Leek", "+8,00", "8,00", PCS],
      ]),
    );
    expect(lastLedgerRequest()).toEqual({ storage: COLD_ROOM.id });
  });

  it("narrows the ledger to one share article and back to all of them", async () => {
    renderPage();
    await cellarLedgerShown();

    await chooseOption(ledgerArticleSelect(), "Leek");

    await waitFor(() => expect(ledgerRows()).toEqual([CELLAR_ROWS.purchase]));
    expect(lastLedgerRequest()).toEqual({ storage: CELLAR.id, share_article: LEEK.id });

    await chooseOption(ledgerArticleSelect(), "commissioning.all_share_articles");

    await cellarLedgerShown();
    expect(lastLedgerRequest()).toEqual({ storage: CELLAR.id });
  });

  it("asks for the movements of the date range the user picks, and for all again once it is cleared", async () => {
    renderPage();
    await cellarLedgerShown();

    await pickDateRange("2026-10-01", "2026-10-04");

    await waitFor(() => expect(ledgerRows()).toEqual([CELLAR_ROWS.count, CELLAR_ROWS.shares]));
    expect(lastLedgerRequest()).toEqual({
      storage: CELLAR.id,
      start_date: "2026-10-01",
      end_date: "2026-10-04",
    });
    const startInput = screen.getByPlaceholderText("common.start_date");
    expect(startInput).toHaveValue("01.10.2026");
    expect(screen.getByPlaceholderText("common.end_date")).toHaveValue("04.10.2026");

    await userEvent.click(
      within(startInput.closest(".ant-picker") as HTMLElement).getByRole("button", {
        name: "close-circle",
      }),
    );

    await cellarLedgerShown();
    expect(lastLedgerRequest()).toEqual({ storage: CELLAR.id });
    expect(startInput).toHaveValue("");
  });

  it("offers last month as a ready-made range", async () => {
    renderPage();
    await cellarLedgerShown();

    await userEvent.click(screen.getByPlaceholderText("common.start_date"));
    await userEvent.click(within(openPickerDropdown()).getByText("common.last_month"));

    await waitFor(() =>
      expect(lastLedgerRequest()).toEqual({
        storage: CELLAR.id,
        start_date: "2026-09-01",
        end_date: "2026-09-30",
      }),
    );
    await waitFor(() =>
      expect(ledgerRows()).toEqual([CELLAR_ROWS.purchase, CELLAR_ROWS.harvest]),
    );
  });

  it("shows ten movements per page and more when the user picks a larger page", async () => {
    server.ledgers[CELLAR.id!] = Array.from({ length: 12 }, (_, index) => {
      const isoDate = dayjs("2026-09-14").add(index, "day").format("YYYY-MM-DD");
      return movement(`mv-${index}`, "HARVEST", isoDate, CARROTS, 1, index + 1);
    });
    renderPage();
    await waitFor(() => expect(ledgerRows()).toHaveLength(10));

    // The ledger has a page-size select above and below it.
    const ledgerWrapper = ledgerTable().closest(".ant-table-wrapper") as HTMLElement;
    await chooseOption(
      within(ledgerWrapper).getAllByRole("combobox", { name: "Page Size" })[0],
      "20 table.items_per_page",
    );

    await waitFor(() => expect(ledgerRows()).toHaveLength(12));
  });

  it("says so when the storage has no movements", async () => {
    server.ledgers[CELLAR.id!] = [];
    renderPage();

    await waitFor(() => expect(api.ledger).toHaveBeenCalled());
    expect(await within(ledgerTable()).findByText("table.no_data")).toBeInTheDocument();
    expect(ledgerRows()).toEqual([]);
  });

  it("asks for no ledger when the farm has no active storage", async () => {
    server.storages = [];
    renderPage();
    await harvestsShown();
    await storagesSettled();

    expect(api.storages).toHaveBeenCalledWith({ is_active: true });
    expect(queryLedgerTable()).toBeNull();
    expect(api.ledger).not.toHaveBeenCalled();
  });
});

// ── Internal workflow ───────────────────────────────────────────────────────

describe("LoggingStorage internal workflow", () => {
  it("lists this year's theoretical harvests newest first with date, link, article, amount and unit", async () => {
    renderPage();
    await harvestsShown();

    expect(api.harvests).toHaveBeenCalledWith({ year: 2026 });
    expect(api.cleanAmounts).not.toHaveBeenCalled();
    expect(api.washAmounts).not.toHaveBeenCalled();
    expect(api.purchaseAmounts).not.toHaveBeenCalled();
    expect(sourceButton("commissioning.theoretical_harvests")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(workflowRows()).toEqual([HARVEST_ROWS.leek, HARVEST_ROWS.carrots, HARVEST_ROWS.open]);
  });

  it("shows a spinner on the workflow until its amounts arrive", async () => {
    const harvests = deferred<TheoreticalHarvest[]>();
    api.harvests.mockImplementation(() => harvests.promise);
    renderPage();

    await waitFor(() => expect(api.harvests).toHaveBeenCalled());
    expect(isLoading(workflowTable())).toBe(true);

    harvests.resolve(HARVESTS.filter((row) => row.year === 2026));

    await harvestsShown();
    await waitFor(() => expect(isLoading(workflowTable())).toBe(false));
  });

  it.each([
    [
      "commissioning.theoretical_clean_amounts",
      api.cleanAmounts,
      ["30.09.2026", "", "Carrots", "18,00", KG],
    ],
    [
      "commissioning.theoretical_wash_amounts",
      api.washAmounts,
      ["01.10.2026", "", "Carrots", "7,50", KG],
    ],
    [
      "commissioning.theoretical_purchase_amounts",
      api.purchaseAmounts,
      ["06.10.2026", "", "Leek", "30,00", PCS],
    ],
  ])("switches the workflow to %s", async (label, request, expectedRow) => {
    renderPage();
    await harvestsShown();

    await userEvent.click(sourceButton(label));

    await waitFor(() => expect(workflowRows()).toEqual([expectedRow]));
    expect(request).toHaveBeenCalledWith({ year: 2026 });
    expect(sourceButton(label)).toHaveAttribute("aria-pressed", "true");
    expect(sourceButton("commissioning.theoretical_harvests")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("switches the source from the keyboard with Enter and Space", async () => {
    renderPage();
    await harvestsShown();

    sourceButton("commissioning.theoretical_wash_amounts").focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(workflowRows()[0]?.[3]).toBe("7,50"));

    sourceButton("commissioning.theoretical_purchase_amounts").focus();
    await userEvent.keyboard(" ");
    await waitFor(() => expect(workflowRows()[0]?.[3]).toBe("30,00"));
    expect(sourceButton("commissioning.theoretical_purchase_amounts")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("follows the year the user steps to", async () => {
    renderPage();
    await harvestsShown();

    await userEvent.click(screen.getByRole("button", { name: "common.next" }));

    await waitFor(() =>
      expect(workflowRows()).toEqual([["11.01.2027", "", "Leek", "12,00", PCS]]),
    );
    expect(api.harvests).toHaveBeenLastCalledWith({ year: 2027 });

    await userEvent.click(screen.getByRole("button", { name: "common.previous" }));

    await harvestsShown();
    expect(api.harvests).toHaveBeenLastCalledWith({ year: 2026 });
  });

  it("narrows the workflow to one share article without touching the ledger", async () => {
    renderPage();
    await cellarLedgerShown();
    await harvestsShown();

    await chooseOption(workflowArticleSelect(), "Carrots");

    await waitFor(() =>
      expect(workflowRows()).toEqual([HARVEST_ROWS.carrots, HARVEST_ROWS.open]),
    );
    expect(api.harvests).toHaveBeenLastCalledWith({ year: 2026, share_article: CARROTS.id });
    expect(api.ledger).toHaveBeenCalledTimes(1);
    expect(ledgerRows()).toHaveLength(5);
  });

  it("hides theoretical amounts of zero until the user asks to see them, independently of the ledger", async () => {
    renderPage();
    await cellarLedgerShown();
    await harvestsShown();

    await userEvent.click(ledgerHideSwitch());
    expect(workflowRows()).not.toContainEqual(HARVEST_ROWS.zero);
    expect(workflowHideSwitch()).toBeChecked();

    await userEvent.click(workflowHideSwitch());

    expect(workflowRows()).toEqual([
      HARVEST_ROWS.leek,
      HARVEST_ROWS.carrots,
      HARVEST_ROWS.zero,
      HARVEST_ROWS.open,
    ]);
  });

  it("says so when there are no theoretical amounts", async () => {
    server.harvests = [];
    renderPage();

    await waitFor(() => expect(api.harvests).toHaveBeenCalled());
    expect(await within(workflowTable()).findByText("table.no_data")).toBeInTheDocument();
  });
});

// ── Tenant formats ──────────────────────────────────────────────────────────

describe("LoggingStorage tenant formats", () => {
  it("formats dates and amounts in the tenant's formats", async () => {
    setTenant({ number_locale: "en-US", date_format: "YYYY-MM-DD" });
    renderPage();
    await cellarLedgerShown();
    await harvestsShown();

    expect(ledgerRows()).toContainEqual([
      "2026-09-28",
      "common.harvest",
      "Carrots",
      "+25.00",
      "25.00",
      KG,
    ]);
    expect(workflowRows()).toContainEqual([
      "2026-09-29",
      "common.share_content",
      "Carrots",
      "25.00",
      KG,
    ]);
  });

  it("adds the size column when the tenant uses sizes", async () => {
    setTenant({ show_size_column: true });
    renderPage();
    await cellarLedgerShown();
    await harvestsShown();

    expect(
      within(ledgerTable()).getByRole("columnheader", { name: "commissioning.size" }),
    ).toBeInTheDocument();
    expect(ledgerRows()[0]).toEqual([...CELLAR_ROWS.order, "commissioning.medium"]);
    expect(workflowRows()[0]).toEqual([...HARVEST_ROWS.leek, "commissioning.medium"]);
  });
});

// ── Failures ────────────────────────────────────────────────────────────────

describe("LoggingStorage failures", () => {
  it("keeps the workflow working when the ledger cannot be loaded", async () => {
    api.ledger.mockRejectedValue(new Error("ledger down"));
    renderPage();

    await harvestsShown();
    await waitFor(() => expect(api.ledger).toHaveBeenCalled());
    await waitFor(() => expect(isLoading(ledgerTable())).toBe(false));
    expect(ledgerRows()).toEqual([]);
  });

  it("drops the previous storage's movements when the next storage's ledger fails", async () => {
    renderPage();
    await cellarLedgerShown();
    api.ledger.mockRejectedValue(new Error("ledger down"));

    await chooseOption(storageSelect(), "Cold room");

    await waitFor(() => expect(lastLedgerRequest()).toEqual({ storage: COLD_ROOM.id }));
    await waitFor(() => expect(ledgerRows()).toEqual([]));
  });

  it("shows no ledger but keeps the workflow when the storages cannot be loaded", async () => {
    api.storages.mockRejectedValue(new Error("storages down"));
    renderPage();

    await harvestsShown();
    await storagesSettled();
    expect(api.storages).toHaveBeenCalled();
    expect(queryLedgerTable()).toBeNull();
    expect(api.ledger).not.toHaveBeenCalled();
  });

  it("keeps the ledger working when the workflow cannot be loaded", async () => {
    api.harvests.mockRejectedValue(new Error("workflow down"));
    renderPage();

    await cellarLedgerShown();
    await waitFor(() => expect(isLoading(workflowTable())).toBe(false));
    expect(workflowRows()).toEqual([]);
  });
});
