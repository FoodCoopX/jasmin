/**
 * StatisticsShareWeights: per ISO week of a date range that starts as the
 * tenant's current fiscal year, the average weight of the weighed shares of
 * each box-packed share type variation as a bar, with its target weight as a
 * dashed line in the bar's colour through every week; a share type's
 * variations share one hue, in shades along their order. Below the chart,
 * each size's figures for the whole range. Rendered through the real range picker, date
 * and number format hooks and the shared bar chart, whose
 * visually-hidden table carries every week's figures. The generated
 * commissioning client is the mocking boundary: its query hook is a real
 * TanStack query around a spy that answers per range.
 *
 * The clock is frozen on Wednesday 7 October 2026.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShareWeightsByWeek, ShareWeightsSummary } from "@shared/api/generated/models";
import type { StatsBarSeries } from "@shared/ui";
import { colorRamp } from "@shared/utils/colorRamp";
import { VARIATION_PALETTE } from "@shared/utils/variationPalette";
import { flushMicrotasks, profileRenders } from "@/test/profileRenders";

const NOW = vi.hoisted(() => {
  const now = new Date(2026, 9, 7, 12, 0);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  return now;
});

// One ``t`` for every call, as the real hook keeps it stable across renders.
// A call with options shows them; the share sizes read S, M and L.
const i18nMock = vi.hoisted(() => {
  const sizes: Record<string, string> = { "commissioning.S": "S", "commissioning.M": "M", "commissioning.L": "L" };
  return {
    t: (key: string, options?: unknown) => {
      if (key in sizes) return sizes[key];
      return options && typeof options === "object" ? `${key} ${JSON.stringify(options)}` : key;
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

// A farm keeping the calendar year, or one whose fiscal year starts in July.
const fiscalYear = vi.hoisted(() => ({ startsInJuly: false }));
vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const getSetting = (_key: string, defaultValue?: unknown) => defaultValue;
  const calendarYear = makeUseTenantMock({ getSetting });
  const fromJuly = makeUseTenantMock({ getSetting, tenant: { fiscal_year_start_month: 7 } });
  return { useTenant: () => (fiscalYear.startsInJuly ? fromJuly : calendarYear) };
});

const api = vi.hoisted(() => ({ shareWeightsByWeek: vi.fn(), shareWeightsSummary: vi.fn() }));

vi.mock("@shared/api/generated/commissioning/commissioning", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    useCommissioningShareWeightsByWeekList: function useShareWeightsByWeek(
      params: unknown,
      options?: { query?: { enabled?: boolean } },
    ) {
      return useQuery({
        queryKey: ["/api/commissioning/share_weights_by_week/", params],
        queryFn: async () => api.shareWeightsByWeek(params),
        enabled: options?.query?.enabled,
      });
    },
    useCommissioningShareWeightsSummaryList: function useShareWeightsSummary(
      params: unknown,
      options?: { query?: { enabled?: boolean } },
    ) {
      return useQuery({
        queryKey: ["/api/commissioning/share_weights_summary/", params],
        queryFn: async () => api.shareWeightsSummary(params),
        enabled: options?.query?.enabled,
      });
    },
  };
});

// The real chart, with the series it was last handed kept for the colours,
// which jsdom never paints.
const chart = vi.hoisted(() => ({ series: [] as StatsBarSeries[] }));
vi.mock("@shared/ui/StatsBarChart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/ui/StatsBarChart")>();
  const RealChart = actual.default;
  return {
    ...actual,
    default: (props: Parameters<typeof RealChart>[0]) => {
      chart.series = props.series;
      return <RealChart {...props} />;
    },
  };
});

import StatisticsShareWeights from "../StatisticsShareWeights";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** The variations the farm weighs, in the server's order: the two
 *  vegetable sizes, then the egg box of an additional share type. */
const VARIATIONS = {
  small: { id: "v-s", shareType: "st-veg", name: "Vegetables", size: "S", target: "2.500", shareTypeRank: 0, rank: 0 },
  medium: { id: "v-m", shareType: "st-veg", name: "Vegetables", size: "M", target: "4.000", shareTypeRank: 0, rank: 1 },
  eggs: { id: "v-e", shareType: "st-eggs", name: "Eggs", size: "L", target: null, shareTypeRank: 1, rank: 2 },
  // The small share's successor, with a higher target.
  smallSuccessor: { id: "v-s2", shareType: "st-veg", name: "Vegetables", size: "S", target: "2.600", shareTypeRank: 0, rank: 3 },
  // Next season's small share: a share type of its own under the same name.
  smallNextSeason: { id: "v-s3", shareType: "st-veg-next", name: "Vegetables", size: "S", target: "2.500", shareTypeRank: 2, rank: 4 },
  // Two share types without a name, each with a small share.
  unnamedSmall: { id: "v-u1", shareType: "st-unnamed-1", name: "", size: "S", target: null, shareTypeRank: 0, rank: 0 },
  otherUnnamedSmall: { id: "v-u2", shareType: "st-unnamed-2", name: "", size: "S", target: null, shareTypeRank: 1, rank: 1 },
};

const point = (
  week: number,
  variation: keyof typeof VARIATIONS,
  averageWeight: string | null,
  weighedShares = 1,
): ShareWeightsByWeek => {
  const of = VARIATIONS[variation];
  return {
    year: 2026,
    week,
    share_type_variation: of.id,
    share_type: of.shareType,
    share_type_name: of.name,
    share_type_rank: of.shareTypeRank,
    size: of.size,
    variation_rank: of.rank,
    target_weight: of.target,
    weighed_shares: averageWeight === null ? 0 : weighedShares,
    average_weight: averageWeight,
  };
};

// Weeks 40 and 41: the small share weighed both weeks, the medium one
// delivered in week 41 without being weighed.
const AUTUMN = [
  point(40, "small", "2.450"),
  point(41, "small", "2.610", 2),
  point(41, "medium", null),
];

const SMALL = "Vegetables · S";
const MEDIUM = "Vegetables · M";
const TARGET_OF = (label: string) =>
  `commissioning.statistics_share_weights_target_of ${JSON.stringify({ label })}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  chart.series = [];
  fiscalYear.startsInJuly = false;
  api.shareWeightsByWeek.mockReset().mockResolvedValue(AUTUMN);
  api.shareWeightsSummary.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function renderPage() {
  const profiler = profileRenders();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      {profiler.wrap(<StatisticsShareWeights />)}
    </QueryClientProvider>,
  );
  return { profiler };
}

const CHART = "commissioning.statistics_share_weights_chart_title";

/** The chart's screen-reader table: its column headers and its rows. */
function chartTable(): { headers: string[]; rows: Map<string, string[]> } {
  const table = screen.getByRole("table", { name: CHART });
  const headers = Array.from(table.querySelectorAll("thead th"), (cell) => cell.textContent ?? "");
  const rows = new Map(
    Array.from(table.querySelectorAll("tbody > tr"), (row) => {
      const [week, ...values] = Array.from(row.querySelectorAll("th, td"), (cell) => cell.textContent ?? "");
      return [week, values] as [string, string[]];
    }),
  );
  return { headers, rows };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("StatisticsShareWeights", () => {
  it("asks for the current calendar year when the tenant keeps no fiscal start month", async () => {
    renderPage();

    await waitFor(() => expect(api.shareWeightsByWeek).toHaveBeenCalledTimes(1));
    expect(api.shareWeightsByWeek.mock.calls[0][0]).toEqual({ start_date: "2026-01-01", end_date: "2026-12-31" });
    expect(screen.getByRole("heading", { name: "commissioning.statistics_share_weights" })).toBeInTheDocument();
    expect(screen.getByText("commissioning.statistics_share_weights_target_hint")).toBeInTheDocument();
    expect(screen.getByText("explainers.statistics_share_weights")).toBeInTheDocument();
  });

  it("lists every week of the range with each variation's average and target weight", async () => {
    renderPage();
    await screen.findByRole("table", { name: CHART });

    const { headers, rows } = chartTable();
    expect(headers).toEqual(["commissioning.KW", SMALL, TARGET_OF(SMALL), MEDIUM, TARGET_OF(MEDIUM)]);
    // 1 January 2026 falls in ISO week 1, 31 December in week 53.
    expect(rows.size).toBe(53);
    expect(rows.get("40")).toEqual(["2,450 kg", "2,500 kg", "", "4,000 kg"]);
    expect(rows.get("41")).toEqual(["2,610 kg", "2,500 kg", "", "4,000 kg"]);
    // A week without a delivery has no average, and the targets run through
    // it, so that even the medium share, delivered in week 41 alone, draws
    // its line.
    expect(rows.get("1")).toEqual(["", "2,500 kg", "", "4,000 kg"]);
    expect(rows.get("42")).toEqual(["", "2,500 kg", "", "4,000 kg"]);
  });

  it("names the weeks with their year once the range spans two years", async () => {
    fiscalYear.startsInJuly = true;
    renderPage();
    await screen.findByRole("table", { name: CHART });

    expect(api.shareWeightsByWeek.mock.calls[0][0]).toEqual({ start_date: "2026-07-01", end_date: "2027-06-30" });
    const { rows } = chartTable();
    expect(rows.get("40/2026")).toEqual(["2,450 kg", "2,500 kg", "", "4,000 kg"]);
    expect(rows.has("1/2027")).toBe(true);
    expect(rows.has("40")).toBe(false);
  });

  it("draws each target as a dashed line in its bar's colour", async () => {
    renderPage();
    await screen.findByRole("table", { name: CHART });

    const [small, smallTarget, medium, mediumTarget] = chart.series;
    expect(small).toMatchObject({ id: "average_v-s", label: SMALL });
    expect(small.reference).toBeUndefined();
    expect(smallTarget).toMatchObject({ id: "target_v-s", color: small.color, reference: true });
    expect(mediumTarget).toMatchObject({ id: "target_v-m", color: medium.color, reference: true });
  });

  it("shades a share type's variations in its hue, in their order, and gives another share type its own", async () => {
    // Listed out of order: the bars follow the variations' order, not the response's.
    api.shareWeightsByWeek.mockResolvedValue([
      point(41, "eggs", "0.620"),
      point(41, "medium", "4.100"),
      point(41, "small", "2.450"),
    ]);
    renderPage();
    await screen.findByRole("table", { name: CHART });

    const bars = chart.series.filter((series) => !series.reference);
    expect(bars.map((bar) => bar.label)).toEqual([SMALL, MEDIUM, "Eggs · L"]);
    expect(bars.map((bar) => bar.color)).toEqual([
      ...colorRamp(VARIATION_PALETTE[0], 2, false),
      VARIATION_PALETTE[1].toLowerCase(),
    ]);
  });

  it("continues a size's line with its successor variation, the target stepping where it changes", async () => {
    api.shareWeightsByWeek.mockResolvedValue([
      point(40, "small", "2.450"),
      point(42, "smallSuccessor", "2.550"),
    ]);
    renderPage();
    await screen.findByRole("table", { name: CHART });

    const { headers, rows } = chartTable();
    expect(headers).toEqual(["commissioning.KW", SMALL, TARGET_OF(SMALL)]);
    // Before the first delivery the first target, between deliveries the one
    // before, from the successor's week on its own.
    expect(rows.get("39")).toEqual(["", "2,500 kg"]);
    expect(rows.get("40")).toEqual(["2,450 kg", "2,500 kg"]);
    expect(rows.get("41")).toEqual(["", "2,500 kg"]);
    expect(rows.get("42")).toEqual(["2,550 kg", "2,600 kg"]);
    expect(rows.get("43")).toEqual(["", "2,600 kg"]);
  });

  it("continues a size's line, and its share type's hue, into next season's share type of the same name", async () => {
    api.shareWeightsByWeek.mockResolvedValue([
      point(40, "small", "2.450"),
      point(40, "medium", "4.100"),
      point(42, "smallNextSeason", "2.550"),
    ]);
    renderPage();
    await screen.findByRole("table", { name: CHART });

    const bars = chart.series.filter((series) => !series.reference);
    expect(bars.map((bar) => bar.label)).toEqual([SMALL, MEDIUM]);
    expect(bars.map((bar) => bar.color)).toEqual(colorRamp(VARIATION_PALETTE[0], 2, false));
    expect(chartTable().rows.get("42")).toEqual(["2,550 kg", "2,500 kg", "", "4,000 kg"]);
  });

  it("averages a size over the weighed shares of every variation delivering it that week", async () => {
    // One share at 2.400 kg, two at 2.700 kg: 2.600 kg, not the 2.550 kg
    // halfway between the two averages.
    api.shareWeightsByWeek.mockResolvedValue([
      point(41, "small", "2.400", 1),
      point(41, "smallNextSeason", "2.700", 2),
    ]);
    renderPage();
    await screen.findByRole("table", { name: CHART });

    expect(chartTable().rows.get("41")).toEqual(["2,600 kg", "2,500 kg"]);
  });

  it("keeps the same size of two share types without a name apart", async () => {
    api.shareWeightsByWeek.mockResolvedValue([
      point(41, "unnamedSmall", "2.000"),
      point(41, "otherUnnamedSmall", "3.000"),
    ]);
    renderPage();
    await screen.findByRole("table", { name: CHART });

    const bars = chart.series.filter((series) => !series.reference);
    expect(bars.map((bar) => bar.id)).toEqual(["average_v-u1", "average_v-u2"]);
    expect(bars.map((bar) => bar.color)).toEqual([
      VARIATION_PALETTE[0].toLowerCase(),
      VARIATION_PALETTE[1].toLowerCase(),
    ]);
  });

  it("shows each size's figures for the whole range below the chart", async () => {
    const summaryRow = (
      variation: keyof typeof VARIATIONS,
      figures: Partial<ShareWeightsSummary>,
    ): ShareWeightsSummary => ({
      share_type_variation: VARIATIONS[variation].id,
      share_type_name: VARIATIONS[variation].name,
      size: VARIATIONS[variation].size,
      target_weight: VARIATIONS[variation].target,
      weighed_boxes: 0,
      average_weight: null,
      standard_deviation: null,
      total_difference_from_target: null,
      ...figures,
    });
    api.shareWeightsSummary.mockResolvedValue([
      summaryRow("small", {
        weighed_boxes: 4,
        average_weight: "2.525",
        standard_deviation: "0.299",
        total_difference_from_target: "0.100",
      }),
      // One box, under its target: no spread yet.
      summaryRow("medium", {
        weighed_boxes: 1,
        average_weight: "3.800",
        total_difference_from_target: "-0.200",
      }),
      // Delivered, never weighed: no figures.
      summaryRow("eggs", {}),
    ]);
    renderPage();

    const card = (await screen.findByText("commissioning.statistics_share_weights_summary_title")).closest(".ant-card");
    if (!(card instanceof HTMLElement)) throw new Error("No summary card");
    const cellsOf = (label: string) =>
      Array.from(within(card).getByText(label).closest("tr")!.querySelectorAll("td"), (cell) => cell.textContent);

    await waitFor(() => expect(within(card).getByText(SMALL)).toBeInTheDocument());
    expect(api.shareWeightsSummary.mock.calls[0][0]).toEqual({ start_date: "2026-01-01", end_date: "2026-12-31" });
    expect(cellsOf(SMALL)).toEqual([SMALL, "4", "2,525 ± 0,299 kg", "2,500 kg", "+0,100 kg"]);
    expect(cellsOf(MEDIUM)).toEqual([MEDIUM, "1", "3,800 kg", "4,000 kg", "−0,200 kg"]);
    expect(cellsOf("Eggs · L")).toEqual(["Eggs · L", "0", "—", "—", "—"]);
  });

  it("gives each size in the figures its colour from the chart", async () => {
    api.shareWeightsSummary.mockResolvedValue([
      {
        share_type_variation: "v-m",
        share_type_name: "Vegetables",
        size: "M",
        target_weight: "4.000",
        weighed_boxes: 1,
        average_weight: "4.100",
        standard_deviation: null,
        total_difference_from_target: "0.100",
      },
    ]);
    renderPage();
    await screen.findByRole("table", { name: CHART });

    const title = await screen.findByText("commissioning.statistics_share_weights_summary_title");
    const card = title.closest(".ant-card");
    if (!(card instanceof HTMLElement)) throw new Error("No summary card");
    const row = (await within(card).findByText(MEDIUM)).closest("tr")!;
    const medium = chart.series.find((series) => series.id === "average_v-m");
    expect(row.querySelector("circle")?.getAttribute("fill")).toBe(medium?.color);
  });

  it("says when no share was weighed in the range", async () => {
    api.shareWeightsByWeek.mockResolvedValue([point(41, "medium", null)]);
    // The same range's figures: the medium size delivered, never weighed.
    api.shareWeightsSummary.mockResolvedValue([
      {
        share_type_variation: "v-m",
        share_type_name: "Vegetables",
        size: "M",
        target_weight: "4.000",
        weighed_boxes: 0,
        average_weight: null,
        standard_deviation: null,
        total_difference_from_target: null,
      },
    ]);
    renderPage();

    expect(await screen.findByText("commissioning.statistics_share_weights_no_data")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: CHART })).not.toBeInTheDocument();
    // Nor are there figures for the range, once they have arrived.
    await waitFor(() => expect(api.shareWeightsSummary).toHaveBeenCalled());
    await flushMicrotasks();
    expect(screen.queryByText("commissioning.statistics_share_weights_summary_title")).not.toBeInTheDocument();
  });

  it("settles after loading instead of re-rendering in a loop", async () => {
    const { profiler } = renderPage();
    await screen.findByRole("table", { name: CHART });
    await flushMicrotasks();

    expect(profiler.onRender.mock.calls.length).toBeLessThan(100);
  });
});
