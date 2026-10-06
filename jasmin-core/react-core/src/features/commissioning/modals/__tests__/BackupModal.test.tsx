/**
 * BackupModal: the backup ("Ersatz") of one row of the harvest-share planning
 * — which article, in which unit and size, stands in for the planned one, and
 * how much of it goes into each share size on each delivery day.
 *
 * Rendered the way the planning page uses it: mounted closed together with the
 * page, so its delivery days and share sizes have arrived by the time the
 * office opens it on a row, then opened with a snapshot of that row and closed
 * again by letting the row go. The real EditableTable, planning axes and option
 * hooks render; the generated commissioning client is the mocking boundary,
 * its list hooks real TanStack queries around spies that answer from fixtures.
 *
 * The planning week is ISO week 42 of 2026 (Monday 12 October). Nothing on
 * this screen reads today's date, so the clock runs free.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ShareArticle,
  SharesDeliveryDay,
  ShareTypeVariation,
} from "@shared/api/generated/models";
import i18n from "@shared/i18n";
import { flushMicrotasks, profileRenders } from "@/test/profileRenders";

// The canonical mock, with one `t` for every render as react-i18next keeps it.
const i18nMock = vi.hoisted(() => ({
  t: (key: string, fallback?: unknown) =>
    typeof fallback === "string" ? fallback : key,
}));
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

// ``useRoles`` is real; it reads the roles of the signed-in user from here.
const auth = vi.hoisted(() => ({ roles: ["office"] as string[] }));
vi.mock("@shared/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { roles: auth.roles } }),
}));

vi.mock("@shared/contexts/ModalContext", () => ({
  useModal: () => ({ isModalMode: false }),
}));

const api = vi.hoisted(() => ({
  deliveryDays: vi.fn(),
  variations: vi.fn(),
  shareArticles: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@shared/api/generated/commissioning/commissioning", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  type Options = { query?: { enabled?: boolean } };
  const useListQuery = (
    path: string,
    params: unknown,
    fetch: (params: unknown) => unknown,
    options?: Options,
  ) =>
    useQuery({
      queryKey: [`/api/commissioning/${path}/`, params],
      queryFn: () => fetch(params),
      enabled: options?.query?.enabled,
    });
  return {
    useCommissioningSharesDeliveryDaysList: (params: unknown) =>
      useListQuery("shares_delivery_days", params, api.deliveryDays),
    useCommissioningShareTypeVariationsList: (params: unknown, options?: Options) =>
      useListQuery("share_type_variations", params, api.variations, options),
    useCommissioningShareArticlesList: (params: unknown) =>
      useListQuery("share_articles", params, api.shareArticles),
    commissioningHarvestSharePlanningBackupUpdate: (id: string, payload: unknown) =>
      api.update(id, payload),
  };
});

import BackupModal from "../BackupModal";

// ── Fixtures ────────────────────────────────────────────────────────────────

const YEAR = 2026;
const WEEK = 42;
// The Saturday of the planning week, which the axes are read for.
const ACTIVE_AT = "2026-10-17";
const HARVEST = "HARVEST_SHARE";

const station = (id: string, short_name: string) => ({
  id,
  short_name,
  tour_number: 1,
  stop_order: 1,
});

// The farm delivers on Tuesdays and Thursdays; the Saturday delivery day has
// no station this week.
const DELIVERY_DAYS: SharesDeliveryDay[] = [
  {
    id: "sdd-tue",
    day_number: 1,
    valid_from: "2025-01-06",
    delivery_stations: [station("station-mill", "Mill")],
  },
  {
    id: "sdd-thu",
    day_number: 3,
    valid_from: "2025-01-06",
    delivery_stations: [station("station-farm", "Farm")],
  },
  { id: "sdd-sat", day_number: 5, valid_from: "2026-01-05", delivery_stations: [] },
];
const DAYS_WITH_STATIONS = ["sdd-tue", "sdd-thu"];

// The two share sizes, listed large first; the office sorts small before large.
const VARIATIONS: ShareTypeVariation[] = [
  { id: "var-large", size: "L", sort_order: 3, share_type: "st-harvest", valid_from: "2026-01-05" },
  { id: "var-small", size: "S", sort_order: 1, share_type: "st-harvest", valid_from: "2026-01-05" },
];

const article = (
  id: string,
  name: string,
  unit: ShareArticle["default_movement_unit"],
): ShareArticle => ({
  id,
  name,
  default_movement_unit: unit,
  is_active: true,
  is_purchased: false,
});
const ARTICLES: ShareArticle[] = [
  article("art-carrot", "Carrots", "KG"),
  article("art-beet", "Beetroot", "KG"),
  article("art-kohlrabi", "Kohlrabi", "PCS"),
  article("art-lettuce", "Lettuce", "PCS"),
];

// Labels as the mocked `t` returns them.
const TUE = "delivery.di";
const THU = "delivery.do";
const SAT = "delivery.sa";
const SMALL = "commissioning.S";
const LARGE = "commissioning.L";
const DAY_LABELS = [TUE, THU, SAT];

// Column titles, which also name the inputs of the row being edited.
const VEGETABLE = "commissioning.vegetable";
const UNIT = "commissioning.unit";
const SIZE = "commissioning.size";

type PlanningRow = Record<string, unknown> & { id: string; key: string };

const amountKey = (dayId: string, variationId: string) =>
  `day_${dayId}_variation_${variationId}`;
const backupKey = (dayId: string, variationId: string) =>
  `backup_${amountKey(dayId, variationId)}`;

/** A row of the planning grid, as the page hands it to the modal. */
function planningRow(
  fields: Record<string, unknown> & {
    share_article: string;
    unit: string;
    size: string;
  },
): PlanningRow {
  const id = `${YEAR}_${WEEK}_${fields.share_article}_${fields.unit}_${fields.size}`;
  return {
    id,
    key: id,
    year: YEAR,
    delivery_week: WEEK,
    share_article_name: ARTICLES.find((item) => item.id === fields.share_article)?.name,
    backup_share_article: null,
    backup_share_article_name: null,
    backup_unit: null,
    backup_size: "M",
    ...fields,
  };
}

// Carrots by the kilo, with beetroot by the kilo standing in for them.
const CARROTS = planningRow({
  share_article: "art-carrot",
  unit: "KG",
  size: "M",
  [amountKey("sdd-tue", "var-small")]: "0.800",
  [amountKey("sdd-tue", "var-large")]: "1.500",
  [amountKey("sdd-thu", "var-small")]: "0.800",
  [amountKey("sdd-thu", "var-large")]: "1.500",
  backup_share_article: "art-beet",
  backup_share_article_name: "Beetroot",
  backup_unit: "KG",
  backup_size: "M",
  [backupKey("sdd-tue", "var-small")]: "0.500",
  [backupKey("sdd-tue", "var-large")]: "1.000",
  [backupKey("sdd-thu", "var-small")]: "0.750",
  [backupKey("sdd-thu", "var-large")]: 0,
});

// The backup amounts of CARROTS as the grid shows them, keyed "<day> <size>".
const CARROT_BACKUP = {
  [`${TUE} ${SMALL}`]: "0,50",
  [`${TUE} ${LARGE}`]: "1,00",
  [`${THU} ${SMALL}`]: "0,75",
  [`${THU} ${LARGE}`]: "",
};

/** The planning row the backend sends back after saving a backup. */
function savedRow(row: PlanningRow, payload: Record<string, unknown>): PlanningRow {
  const backup = ARTICLES.find((item) => item.id === payload.backup_share_article);
  const amounts = Object.fromEntries(
    DAYS_WITH_STATIONS.flatMap((dayId) =>
      VARIATIONS.map((variation) => {
        const value = Number(payload[amountKey(dayId, variation.id!)]);
        return [backupKey(dayId, variation.id!), value ? value.toFixed(3) : 0];
      }),
    ),
  );
  return {
    ...row,
    backup_share_article: backup?.id ?? null,
    backup_share_article_name: backup?.name ?? null,
    backup_unit: payload.backup_unit || null,
    backup_size: payload.backup_size || "M",
    ...amounts,
  };
}

// The planning rows the server knows, by id.
let serverRows: Record<string, PlanningRow> = {};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Mounts the modal closed, as the planning page does, with the ways the page
 * opens it on a row and closes it again.
 */
function renderModal({ showDaysTogether = false } = {}) {
  const onClose = vi.fn();
  const onSave = vi.fn();
  const profiler = profileRenders();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const modal = (visible: boolean, data: PlanningRow | null) => (
    <QueryClientProvider client={queryClient}>
      {profiler.wrap(
        <BackupModal
          visible={visible}
          onClose={onClose}
          data={data}
          year={YEAR}
          delivery_week={WEEK}
          shareOption={HARVEST}
          showDaysTogether={showDaysTogether}
          onSave={onSave}
        />,
      )}
    </QueryClientProvider>
  );
  const view = render(modal(false, null));

  /** Opens on `row` once the days, sizes and articles have arrived. */
  async function open(row: PlanningRow = CARROTS) {
    await waitFor(() => {
      expect(api.deliveryDays).toHaveBeenCalled();
      expect(api.variations).toHaveBeenCalled();
      expect(api.shareArticles).toHaveBeenCalled();
      expect(queryClient.isFetching()).toBe(0);
    });
    view.rerender(modal(true, row));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
  }

  /** Closes it the way the page does: hidden, its row let go. */
  function close() {
    view.rerender(modal(false, null));
  }

  /** The days, sizes and articles are fetched again, as after a focus. */
  async function refetchAxes() {
    await act(async () => {
      await queryClient.invalidateQueries();
    });
  }

  return { onClose, onSave, profiler, open, close, refetchAxes };
}

async function renderOpen(
  row: PlanningRow = CARROTS,
  options: { showDaysTogether?: boolean } = {},
) {
  const modal = renderModal(options);
  await modal.open(row);
  return modal;
}

const dialog = () => screen.getByRole("dialog");

function bodyRows(): HTMLTableRowElement[] {
  return Array.from(
    document.querySelectorAll<HTMLTableRowElement>(
      ".ant-modal .ant-table-tbody > tr.ant-table-row",
    ),
  );
}

function backupRow(): HTMLTableRowElement {
  const rows = bodyRows();
  if (rows.length !== 1) throw new Error(`Expected one backup row, found ${rows.length}`);
  return rows[0];
}

/** The backup row's cell under the article, unit or size header. */
function cellUnder(title: string): HTMLTableCellElement {
  const header = within(dialog()).getByRole("columnheader", { name: title });
  return backupRow().cells[(header as HTMLTableCellElement).cellIndex];
}

interface AmountColumn {
  group: string;
  leaf: string;
  cell: HTMLTableCellElement;
}

/**
 * The amount columns in display order: each leaf header with the group header
 * above it, and the backup row's cell beneath it.
 */
function amountColumns(): AmountColumn[] {
  const [groupRow, leafRow] = Array.from(
    dialog().querySelectorAll<HTMLTableRowElement>(".ant-table-thead > tr"),
  );
  // The actions, article, unit and size headers span both header rows.
  const spanning = Array.from(groupRow.cells).filter((cell) => cell.rowSpan > 1);
  const groupOfLeaf = Array.from(groupRow.cells)
    .filter((cell) => cell.rowSpan === 1)
    .flatMap((cell) => Array<string>(cell.colSpan).fill(cell.textContent ?? ""));
  const row = backupRow();
  return Array.from(leafRow.cells).map((leaf, index) => ({
    group: groupOfLeaf[index],
    leaf: leaf.textContent ?? "",
    cell: row.cells[spanning.length + index],
  }));
}

const headerNesting = () =>
  amountColumns().map(({ group, leaf }) => `${group} › ${leaf}`);

/** The amount cell of a delivery day and share size, whichever way they nest. */
function amountCell(day: string, size: string): HTMLTableCellElement {
  const column = amountColumns().find(
    ({ group, leaf }) =>
      (group === day && leaf === size) || (group === size && leaf === day),
  );
  if (!column) throw new Error(`No amount column for ${day} and ${size}`);
  return column.cell;
}

const amountInput = (day: string, size: string) =>
  within(amountCell(day, size)).getByRole("textbox");

/** Every amount shown, keyed "<day> <size>". */
function shownAmounts(): Record<string, string> {
  return Object.fromEntries(
    amountColumns().map(({ group, leaf, cell }) => {
      const [day, size] = DAY_LABELS.includes(group) ? [group, leaf] : [leaf, group];
      return [`${day} ${size}`, cell.textContent ?? ""];
    }),
  );
}

async function startEditing() {
  await userEvent.click(within(backupRow()).getByRole("button", { name: "table.edit" }));
}

async function typeAmount(day: string, size: string, text: string) {
  const input = amountInput(day, size);
  await userEvent.clear(input);
  if (text) await userEvent.type(input, text);
}

/** The options of the select dropdown open right now. */
function openOptions(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
    ),
  );
}

async function openSelect(column: string) {
  await userEvent.click(within(backupRow()).getByRole("combobox", { name: column }));
}

/** Picks `option` in the select of the column titled `column`. */
async function pick(column: string, option: string) {
  await openSelect(column);
  const item = await waitFor(() => {
    const match = openOptions().find(
      (candidate) => candidate.getAttribute("title") === option,
    );
    if (!match) throw new Error(`No option ${option} is offered`);
    return match;
  });
  await userEvent.click(item);
}

async function save() {
  await userEvent.click(screen.getByRole("button", { name: "table.save" }));
}

beforeEach(() => {
  tenantSettings.values = {};
  auth.roles = ["office"];
  serverRows = { [CARROTS.id]: CARROTS };
  api.deliveryDays
    .mockReset()
    .mockImplementation(async () => DELIVERY_DAYS.map((day) => ({ ...day })));
  api.variations
    .mockReset()
    .mockImplementation(async () => VARIATIONS.map((variation) => ({ ...variation })));
  api.shareArticles
    .mockReset()
    .mockImplementation(async () => ARTICLES.map((item) => ({ ...item })));
  api.update
    .mockReset()
    .mockImplementation(async (id: string, payload: Record<string, unknown>) => {
      const saved = savedRow(serverRows[id], payload);
      serverRows[id] = saved;
      return saved;
    });
});

// ── What the office sees ────────────────────────────────────────────────────

describe("BackupModal contents", () => {
  it("is titled after the planned article, size and unit and says where the backup goes", async () => {
    await renderOpen();

    // The title key's German text ends in "für: ", ahead of the article.
    expect(
      await screen.findAllByText(
        "commissioning.backup_planningCarrots - commissioning.medium (commissioning.units.kg)",
      ),
    ).not.toHaveLength(0);
    expect(within(dialog()).getByText("commissioning.backup_modal_info")).toBeInTheDocument();
  });

  it("shows the backup's article, unit and size and its amount per delivery day and share size", async () => {
    await renderOpen();

    expect(cellUnder(VEGETABLE)).toHaveTextContent("Beetroot");
    expect(cellUnder(UNIT)).toHaveTextContent("commissioning.units.kg");
    expect(cellUnder(SIZE)).toHaveTextContent("commissioning.medium");
    // A zero amount stays blank.
    expect(shownAmounts()).toEqual(CARROT_BACKUP);
  });

  it("takes its days and sizes from the planning week: only days with a station, sizes in the office's order", async () => {
    await renderOpen();

    expect(api.deliveryDays).toHaveBeenCalledWith(
      expect.objectContaining({ active_at_date: ACTIVE_AT }),
    );
    expect(api.variations).toHaveBeenCalledWith(
      expect.objectContaining({ active_at_date: ACTIVE_AT, share_option: HARVEST }),
    );
    expect(headerNesting()).not.toContainEqual(expect.stringContaining(SAT));
    expect(headerNesting()).toEqual([
      `${TUE} › ${SMALL}`,
      `${TUE} › ${LARGE}`,
      `${THU} › ${SMALL}`,
      `${THU} › ${LARGE}`,
    ]);
  });

  it("groups the days under each size when the planning shows the days together", async () => {
    await renderOpen(CARROTS, { showDaysTogether: true });

    expect(headerNesting()).toEqual([
      `${SMALL} › ${TUE}`,
      `${SMALL} › ${THU}`,
      `${LARGE} › ${TUE}`,
      `${LARGE} › ${THU}`,
    ]);
    expect(shownAmounts()).toEqual(CARROT_BACKUP);
  });

  it("shows the amounts in the tenant's number format", async () => {
    tenantSettings.values = { number_locale: "en-US" };
    await renderOpen();

    expect(shownAmounts()).toEqual({
      [`${TUE} ${SMALL}`]: "0.50",
      [`${TUE} ${LARGE}`]: "1.00",
      [`${THU} ${SMALL}`]: "0.75",
      [`${THU} ${LARGE}`]: "",
    });
  });

  it("shows a backup counted in pieces to one decimal", async () => {
    const kohlrabi = planningRow({
      share_article: "art-kohlrabi",
      unit: "PCS",
      size: "L",
      backup_share_article: "art-lettuce",
      backup_share_article_name: "Lettuce",
      backup_unit: "PCS",
      backup_size: "M",
      [backupKey("sdd-tue", "var-small")]: "1.000",
      [backupKey("sdd-tue", "var-large")]: "2.000",
      [backupKey("sdd-thu", "var-small")]: "1.500",
      [backupKey("sdd-thu", "var-large")]: "2.000",
    });
    await renderOpen(kohlrabi);

    expect(
      await screen.findAllByText(
        "commissioning.backup_planningKohlrabi - commissioning.large (commissioning.units.pcs)",
      ),
    ).not.toHaveLength(0);
    expect(cellUnder(UNIT)).toHaveTextContent("commissioning.units.pcs");
    expect(shownAmounts()).toEqual({
      [`${TUE} ${SMALL}`]: "1,0",
      [`${TUE} ${LARGE}`]: "2,0",
      [`${THU} ${SMALL}`]: "1,5",
      [`${THU} ${LARGE}`]: "2,0",
    });
  });

  it("settles after opening instead of re-rendering in a loop", async () => {
    const { profiler } = await renderOpen();
    await act(() => flushMicrotasks());

    expect(profiler.onRender.mock.calls.length).toBeLessThan(100);
  });
});

// ── Editing ─────────────────────────────────────────────────────────────────

describe("BackupModal editing", () => {
  it.each([
    { nesting: "sizes under each day", showDaysTogether: false },
    { nesting: "days under each size", showDaysTogether: true },
  ])(
    "saves changed amounts with the backup's article, unit and size ($nesting)",
    async ({ showDaysTogether }) => {
      const { onSave } = await renderOpen(CARROTS, { showDaysTogether });

      await userEvent.click(amountCell(TUE, SMALL));
      await typeAmount(TUE, SMALL, "1,25");
      await typeAmount(THU, SMALL, "");
      await save();

      await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
      expect(api.update).toHaveBeenCalledWith(CARROTS.id, {
        backup_share_article: "art-beet",
        backup_unit: "KG",
        backup_size: "M",
        [amountKey("sdd-tue", "var-small")]: "1.25",
        [amountKey("sdd-tue", "var-large")]: "1.000",
        [amountKey("sdd-thu", "var-small")]: 0,
        [amountKey("sdd-thu", "var-large")]: 0,
      });
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("button", { name: "table.save" })).not.toBeInTheDocument();
      expect(shownAmounts()).toEqual({
        ...CARROT_BACKUP,
        [`${TUE} ${SMALL}`]: "1,25",
        [`${THU} ${SMALL}`]: "",
      });
    },
  );

  it("opens the amounts for editing in the tenant's decimal format", async () => {
    await renderOpen();
    await startEditing();

    expect(amountInput(TUE, SMALL)).toHaveValue("0,500");
    expect(amountInput(TUE, LARGE)).toHaveValue("1,000");
  });

  it("offers the farm's active harvest-share articles as the backup", async () => {
    await renderOpen();
    await startEditing();
    await openSelect(VEGETABLE);

    expect(api.shareArticles).toHaveBeenCalledWith({
      is_harvest_share_article: true,
      is_active: true,
      is_purchased: false,
    });
    await waitFor(() =>
      expect(
        openOptions()
          .map((option) => option.textContent)
          .filter(Boolean),
      ).toEqual(["Carrots", "Beetroot", "Kohlrabi", "Lettuce"]),
    );
  });

  it("saves another backup article, unit and size", async () => {
    const { onSave } = await renderOpen();
    await startEditing();

    await pick(VEGETABLE, "Lettuce");
    await pick(UNIT, "commissioning.units.pcs");
    await pick(SIZE, "commissioning.large");
    await save();

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith(CARROTS.id, {
      backup_share_article: "art-lettuce",
      backup_unit: "PCS",
      backup_size: "L",
      [amountKey("sdd-tue", "var-small")]: "0.500",
      [amountKey("sdd-tue", "var-large")]: "1.000",
      [amountKey("sdd-thu", "var-small")]: "0.750",
      [amountKey("sdd-thu", "var-large")]: 0,
    });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(cellUnder(VEGETABLE)).toHaveTextContent("Lettuce");
    expect(cellUnder(UNIT)).toHaveTextContent("commissioning.units.pcs");
    expect(cellUnder(SIZE)).toHaveTextContent("commissioning.large");
  });

  it("keeps the typed amount open for another try when the save is refused, and says why", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.update.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 404,
        data: {
          code: "share_content.not_found",
          message: "No share content found for the given parameters",
        },
      },
    });
    const { onSave } = await renderOpen();
    await startEditing();
    await typeAmount(TUE, SMALL, "1,25");
    await save();

    const message = i18n.t("errors.share_content.not_found");
    expect(message).not.toBe("errors.share_content.not_found");
    expect(
      await within(dialog()).findByText(`${message} — table.save_failed_hint`),
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(amountInput(TUE, SMALL)).toHaveValue("1,25");

    await save();

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(amountCell(TUE, SMALL)).toHaveTextContent("1,25");
  });

  it("keeps an amount being typed when the days and sizes are fetched again", async () => {
    const modal = await renderOpen();
    await startEditing();
    await typeAmount(TUE, SMALL, "1,25");

    await modal.refetchAxes();

    expect(api.deliveryDays).toHaveBeenCalledTimes(2);
    expect(api.variations).toHaveBeenCalledTimes(2);
    expect(amountInput(TUE, SMALL)).toHaveValue("1,25");
    await save();
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        CARROTS.id,
        expect.objectContaining({ [amountKey("sdd-tue", "var-small")]: "1.25" }),
      ),
    );
  });

  it("keeps a saved amount when the days and sizes are fetched again while it stays open", async () => {
    const modal = await renderOpen();
    await startEditing();
    await typeAmount(TUE, SMALL, "1,25");
    await save();
    await waitFor(() => expect(modal.onSave).toHaveBeenCalledTimes(1));

    await modal.refetchAxes();
    await flushMicrotasks();

    expect(api.deliveryDays).toHaveBeenCalledTimes(2);
    expect(api.variations).toHaveBeenCalledTimes(2);
    expect(shownAmounts()).toEqual({ ...CARROT_BACKUP, [`${TUE} ${SMALL}`]: "1,25" });
  });

  it("starts from the page's fresh row when opened again", async () => {
    const modal = await renderOpen();
    await startEditing();
    await typeAmount(TUE, SMALL, "1,25");
    await save();
    await waitFor(() => expect(modal.onSave).toHaveBeenCalledTimes(1));

    modal.close();
    // The page has fetched its rows again; Thursday's small share has changed
    // since, by another hand.
    await modal.open({ ...serverRows[CARROTS.id], [backupKey("sdd-thu", "var-small")]: "0.250" });

    expect(shownAmounts()).toEqual({
      ...CARROT_BACKUP,
      [`${TUE} ${SMALL}`]: "1,25",
      [`${THU} ${SMALL}`]: "0,25",
    });
  });

  it("lets an admin edit the backup like the office", async () => {
    auth.roles = ["admin"];
    await renderOpen();

    await userEvent.click(amountCell(THU, SMALL));

    expect(amountInput(THU, SMALL)).toHaveValue("0,750");
    expect(within(backupRow()).getByRole("combobox", { name: VEGETABLE })).toBeInTheDocument();
  });
});

// ── Closing ─────────────────────────────────────────────────────────────────

describe("BackupModal closing", () => {
  it("closes from its footer and from its close icon", async () => {
    const { onClose } = await renderOpen();

    await userEvent.click(within(dialog()).getByRole("button", { name: "common.close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("drops an amount typed but not saved when closed", async () => {
    const modal = await renderOpen();
    await startEditing();
    await typeAmount(TUE, SMALL, "9");

    await userEvent.click(within(dialog()).getByRole("button", { name: "common.close" }));
    modal.close();
    await modal.open(CARROTS);

    expect(api.update).not.toHaveBeenCalled();
    expect(modal.onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "table.save" })).not.toBeInTheDocument();
    expect(shownAmounts()).toEqual(CARROT_BACKUP);
  });
});

// ── Other roles ─────────────────────────────────────────────────────────────

describe("BackupModal for roles other than the office", () => {
  it.each([{ roles: ["staff"] }, { roles: ["gardener"] }, { roles: ["management"] }])(
    "shows the backup read-only to $roles",
    async ({ roles }) => {
      auth.roles = roles;
      await renderOpen();

      expect(shownAmounts()).toEqual(CARROT_BACKUP);
      expect(cellUnder(VEGETABLE)).toHaveTextContent("Beetroot");
      expect(
        within(dialog()).queryByRole("button", { name: "table.edit" }),
      ).not.toBeInTheDocument();

      await userEvent.click(amountCell(TUE, SMALL));
      await userEvent.click(cellUnder(VEGETABLE));

      expect(within(dialog()).queryByRole("textbox")).not.toBeInTheDocument();
      expect(within(dialog()).queryByRole("combobox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "table.save" })).not.toBeInTheDocument();
      expect(api.update).not.toHaveBeenCalled();
    },
  );
});
