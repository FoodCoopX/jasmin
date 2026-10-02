// Forecast is a heavy page whose table columns are built from the share-type
// variations, offer groups and plots: the forecast list query waits until those
// have loaded, and the table shows its loading state meanwhile. This test mocks
// every hook to return resolved data synchronously (or, in one case, the
// variations still loading), asserts what the page renders and that it doesn't
// re-render in a loop. We mock the API boundary + every heavy child rather than
// going through MSW.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { profileRenders, flushMicrotasks } from "@/test/profileRenders";

// ── Mocks ────────────────────────────────────────────────────────────────────

const pageState = vi.hoisted(() => ({
  variationsLoading: false,
  listEnabled: [] as unknown[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : k,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// The generated API boundary. Forecast imports five operation fns + the
// query-key helper + the list hook. The list hook records whether the page
// enabled it, and returns a fully-resolved shape.
vi.mock("@shared/api/generated/commissioning/commissioning", () => ({
  commissioningBulkFinalizeCreate: vi.fn().mockResolvedValue({}),
  commissioningForecastBulkCopyToNextWeekCreate: vi.fn().mockResolvedValue({}),
  commissioningForecastCreate: vi.fn().mockResolvedValue({}),
  commissioningForecastDestroy: vi.fn().mockResolvedValue({}),
  commissioningForecastPartialUpdate: vi.fn().mockResolvedValue({}),
  getCommissioningForecastListQueryKey: () => ["forecast-list"],
  useCommissioningForecastList: (
    _params: unknown,
    options?: { query?: { enabled?: boolean } },
  ) => {
    pageState.listEnabled.push(options?.query?.enabled);
    return {
      data: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    };
  },
}));

// The models module is type-only for ``Forecast`` / ``CommissioningForecastListParams``
// but ``ShareTypeEnum`` is a real runtime value — leave it real (cheap enum).

// @hooks barrel — every hook Forecast reads from it. The tenant mock keeps
// ``getSetting`` permissive (returns the default arg), so ``has_markets`` /
// ``sells_to_resellers`` fall through to their ``true`` defaults.
vi.mock("@hooks/index", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock();
  const { useYearWeekState, currentYear, currentWeek } = await import(
    "@hooks/useYearWeekState"
  );
  return {
    useYearWeekState,
    currentYear,
    currentWeek,
    useTenant: () => tenant,
    useIsMobile: () => false,
    useNoteColumn: () => ({
      noteColumn: { title: "note", dataIndex: "note", key: "note" },
    }),
    // activeShareOptions is read for ``fruit_and_veg_shares_are_separate`` —
    // an empty object makes it ``?? false`` so the (heavier) fruit branch and
    // its second variations query are skipped.
    useActiveShareOptions: () => ({ activeShareOptions: {} }),
    useTableRowSelection: () => ({
      selectedRowKeys: [],
      setSelectedRowKeys: vi.fn(),
      onSelectedRowsChange: vi.fn(),
      rowSelection: { type: "checkbox" },
    }),
    useInvalidateAfterTableMutation: () => ({
      onSaveSuccess: vi.fn(),
      onDeleteSuccess: vi.fn(),
      recentlyAddedIds: new Set<string>(),
    }),
    // Size-label getter for the per-variation column headers ("für GANZ").
    useShareTypeVariationSizeOptions: () => ({
      getShareTypeVariationSizeLabel: (s: string) => s,
    }),
  };
});

// Commissioning feature hooks. The variations, offer groups and plots report
// ``loading``: while any of them loads, the forecast rows wait.
vi.mock("@features/commissioning/hooks", () => ({
  useShareArticles: () => ({ shareArticles: [], refetch: vi.fn() }),
  usePlots: () => ({ plots: [], countPlots: 0, loading: false }),
  useOfferGroups: () => ({
    offerGroups: [],
    offerGroupsCount: 0,
    loading: false,
  }),
  useShareTypeVariations: () => ({
    shareTypeVariations: [],
    shareTypeVariationsCount: 0,
    loading: pageState.variationsLoading,
  }),
  useFinalColumn: () => ({
    finalColumn: { title: "final", dataIndex: "is_finalized", key: "final" },
  }),
  useShareArticleColumn: () => ({
    shareArticleColumn: {
      title: "article",
      dataIndex: "share_article",
      key: "share_article",
    },
  }),
  useAmountUnitSizeColumns: () => ({
    amountUnitSizeColumns: [
      { title: "amount", dataIndex: "amount", key: "amount" },
    ],
  }),
  // Column-builder hook for the page; the table is stubbed
  // below, so an empty column set is enough for the render/smoke tests.
  useForecastColumns: () => [],
}));

vi.mock("@shared/auth", () => ({
  useRoles: () => ({ canEdit: true }),
}));

vi.mock("@shared/contexts/AuthContext", () => ({
  useAuth: () => ({ logout: vi.fn(), user: { roles: ["office"] } }),
}));

// EditableTable → testid stub. Re-export the helpers Forecast imports from this
// module as plain passthroughs so the page's ``gatedByPermission`` /
// ``wrapApiFunctions`` calls don't blow up.
vi.mock("@shared/tables", () => ({
  EditableTable: ({ loading }: { loading?: boolean }) => (
    <div data-testid="editable-table" data-loading={String(Boolean(loading))} />
  ),
  gatedByPermission: (canEdit: boolean) => ({ canEdit }),
  wrapApiFunctions: (fns: unknown) => fns,
}));

// Selectors fire their own queries — stub them.
vi.mock("@shared/selectors", () => ({
  WeekSelector: () => <div data-testid="week-selector" />,
}));

// Shared UI widgets on the page.
vi.mock("@shared/ui", () => ({
  BulkActionButton: () => <div data-testid="bulk-action-button" />,
  ExplainerText: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="explainer-text">{children}</div>
  ),
  PastWarningMessage: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="past-warning">{children}</div>
  ),
  ToolTipIcon: () => <span data-testid="tooltip-icon" />,
}));

// AddShareArticleEntry unconditionally mounts ShareArticleModal (which fires a
// share_options/active query) — stub it.
vi.mock("@features/commissioning/components", () => ({
  AddShareArticleEntry: () => <div data-testid="add-share-article-entry" />,
}));

// Mobile card factory passed to EditableTable — never invoked (EditableTable is
// stubbed) but the import must resolve.
vi.mock("@features/commissioning/components/mobileCards", () => ({
  ForecastMobileCard: () => <div data-testid="forecast-mobile-card" />,
}));

// ── Imports under test ───────────────────────────────────────────────────────

import Forecast from "../Forecast";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  pageState.variationsLoading = false;
  pageState.listEnabled = [];
});

describe("Forecast (smoke)", () => {
  it("renders without crashing once the column data resolves", async () => {
    const client = makeQueryClient();

    render(
      <QueryClientProvider client={client}>
        <Forecast />
      </QueryClientProvider>,
    );

    const table = await screen.findByTestId("editable-table");
    expect(table).toHaveAttribute("data-loading", "false");
    expect(pageState.listEnabled.at(-1)).toBe(true);
    expect(screen.getByTestId("week-selector")).toBeInTheDocument();
    expect(
      screen.getByTestId("add-share-article-entry"),
    ).toBeInTheDocument();
  });

  it("holds the rows back while the column data loads, page still shown", async () => {
    pageState.variationsLoading = true;
    const client = makeQueryClient();

    render(
      <QueryClientProvider client={client}>
        <Forecast />
      </QueryClientProvider>,
    );

    const table = await screen.findByTestId("editable-table");
    expect(table).toHaveAttribute("data-loading", "true");
    expect(pageState.listEnabled.at(-1)).toBe(false);
    expect(screen.getByTestId("week-selector")).toBeInTheDocument();
  });

  // Render-loop smoke test — Forecast composes ~10 hooks + builds a large memo'd
  // column config. A healthy mount commits a handful of times (initial + memo
  // settling). 80 is a generous ceiling that still catches a real
  // setState-in-render loop (which produces thousands of commits).
  it("does not re-render in a loop on initial mount (Profiler smoke test)", async () => {
    const profiler = profileRenders();
    const client = makeQueryClient();

    render(
      <QueryClientProvider client={client}>
        {profiler.wrap(<Forecast />, "forecast")}
      </QueryClientProvider>,
    );

    await screen.findByTestId("editable-table");
    await flushMicrotasks(50);

    expect(profiler.onRender.mock.calls.length).toBeLessThan(80);
  });
});
