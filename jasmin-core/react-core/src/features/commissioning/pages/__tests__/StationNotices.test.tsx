/**
 * StationNotices: the members' notices on a page of their own — what the
 * shares collected at a delivery station hold — for one station, every station
 * of a delivery day or the week. Rendered through its entry in the
 * commissioning route table with the real week, day and station selectors and
 * download buttons. The generated commissioning client is the mocking
 * boundary; the PDF library, the PDF template and the browser download are
 * stubbed.
 *
 * The clock is frozen on Tuesday 6 October 2026 (ISO week 41), before the
 * imports run as well as before every test.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DeliveryStation,
  SharesDeliveryDay,
  StationContents,
} from "@shared/api/generated/models";
import { flushMicrotasks, profileRenders } from "@/test/profileRenders";

const NOW = vi.hoisted(() => {
  const now = new Date(2026, 9, 6, 12, 0);
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

vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock({
    tenantName: "Green Acres",
    logoUrl: "https://example.test/logo.png",
    tenant: { email: "office@example.test", phone_number: "+49 30 1234567" },
  });
  return { useTenant: () => tenant };
});

const session = vi.hoisted(() => ({ roles: [] as string[] }));
vi.mock("@shared/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { roles: session.roles },
    isAuthenticated: true,
    loading: false,
  }),
}));

const api = vi.hoisted(() => ({
  deliveryDays: vi.fn(),
  stations: vi.fn(),
  stationContents: vi.fn(),
  shareTypes: vi.fn(),
}));

vi.mock("@shared/api/generated/commissioning/commissioning", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const queryOptions =
    (path: string, request: (params: unknown) => unknown) =>
    (params?: unknown, options?: { query?: { enabled?: boolean } }) => ({
      queryKey: [`/api/commissioning/${path}/`, ...(params ? [params] : [])],
      queryFn: async () => request(params),
      ...options?.query,
    });
  const queryHook = (path: string, request: (params: unknown) => unknown) => {
    const optionsFor = queryOptions(path, request);
    return function useGeneratedQuery(
      params?: unknown,
      options?: { query?: { enabled?: boolean } },
    ) {
      return useQuery(optionsFor(params, options));
    };
  };
  return {
    useCommissioningSharesDeliveryDaysList: queryHook(
      "shares_delivery_days",
      api.deliveryDays,
    ),
    useCommissioningDeliveryStationsList: queryHook(
      "delivery_stations",
      api.stations,
    ),
    getCommissioningDeliveryStationsListQueryOptions: queryOptions(
      "delivery_stations",
      api.stations,
    ),
    useCommissioningShareTypesList: queryHook("share_types", api.shareTypes),
    getCommissioningPackingListStationContentsRetrieveQueryOptions:
      queryOptions("packing_list/station_contents", api.stationContents),
  };
});

// The page only needs the notice downloads; the barrel would also load every
// other PDF template of the app.
vi.mock("@features/commissioning/pdfs", async () => ({
  StationContentsPDFGenerator: (
    await import("@features/commissioning/pdfs/exports/StationContentsPDFGenerator")
  ).default,
}));
vi.mock("@features/commissioning/pdfs/exports/StationContentsPDF", () => ({
  default: function StationContentsPDF() {
    return null;
  },
}));

const printed = vi.hoisted(() => ({
  documents: [] as { template: string; props: Record<string, unknown> }[],
  files: [] as string[],
}));
vi.mock("@react-pdf/renderer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@react-pdf/renderer")>()),
  pdf: (document: {
    type: { name: string };
    props: Record<string, unknown>;
  }) => ({
    toBlob: async () => {
      printed.documents.push({
        template: document.type.name,
        props: document.props,
      });
      return new Blob(["%PDF-1.7"], { type: "application/pdf" });
    },
  }),
}));
vi.mock("@shared/utils/downloadBlob", () => ({
  downloadBlob: (_blob: Blob, filename: string) => {
    printed.files.push(filename);
  },
}));

import { commissioningRoutes } from "@app/routing/routes/commissioning";
// Loaded up front so the route's lazy import resolves at once.
import "../StationNotices";
import {
  TUESDAY,
  FRIDAY,
  deliveryDay,
  FARM_SHOP,
  MARKET,
  SCHOOL,
  FARM_SHOP_CONTENTS,
  MARKET_CONTENTS,
} from "./deliveryStationsDetails.fixtures";

type ContentsParams = {
  delivery_week: number;
  day_number: number;
  delivery_station: string;
};

let farm: {
  deliveryDays: SharesDeliveryDay[];
  stationsByDeliveryDay: Record<string, DeliveryStation[]>;
  contents: Record<string, StationContents>;
};

const noticeOf = (week: number, dayNumber: number, station: DeliveryStation) =>
  `${week}/${dayNumber}/${station.id}`;

const PATH = "/commissioning/station-notices";

function renderPage() {
  const route = commissioningRoutes.find((entry) => entry.path === PATH);
  if (!route) throw new Error(`No route for ${PATH}`);
  const profiler = profileRenders();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[PATH]}>
        <Suspense fallback={null}>
          <Routes>
            <Route path={PATH} element={profiler.wrap(route.element)} />
          </Routes>
        </Suspense>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { profiler };
}

const STATION_NOTICE = /download\.station_contents_station$/;
const DAY_NOTICE = /download\.station_contents_day$/;
const WEEK_NOTICE = /download\.station_contents_week$/;
const download = (name: RegExp) => screen.getByRole("button", { name });
const settle = () => act(() => flushMicrotasks());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  session.roles = ["office"];
  printed.documents = [];
  printed.files = [];
  farm = {
    deliveryDays: [
      deliveryDay("day-tue", TUESDAY),
      deliveryDay("day-fri", FRIDAY),
    ],
    stationsByDeliveryDay: {
      "day-tue": [FARM_SHOP, MARKET],
      "day-fri": [SCHOOL, MARKET],
    },
    contents: {
      [noticeOf(41, TUESDAY, FARM_SHOP)]: FARM_SHOP_CONTENTS,
      [noticeOf(41, TUESDAY, MARKET)]: MARKET_CONTENTS,
      [noticeOf(41, FRIDAY, MARKET)]: MARKET_CONTENTS,
    },
  };
  api.deliveryDays
    .mockReset()
    .mockImplementation(async () => [...farm.deliveryDays]);
  api.stations
    .mockReset()
    .mockImplementation(async (params: { delivery_day?: string }) => [
      ...(farm.stationsByDeliveryDay[params.delivery_day ?? ""] ?? []),
    ]);
  api.shareTypes.mockReset().mockResolvedValue([]);
  api.stationContents
    .mockReset()
    .mockImplementation(
      async (params: ContentsParams) =>
        farm.contents[
          `${params.delivery_week}/${params.day_number}/${params.delivery_station}`
        ] ?? { shares: [] },
    );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StationNotices", () => {
  it("opens on the week's first delivery day and its first station and offers only the notices", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", {
        name: "commissioning.station_contents.page_title",
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(download(STATION_NOTICE)).toBeEnabled());
    expect(api.stationContents).toHaveBeenCalledWith({
      year: 2026,
      delivery_week: 41,
      day_number: TUESDAY,
      delivery_station: FARM_SHOP.id,
      is_past: false,
    });
    expect(
      screen
        .getAllByRole("button", { name: /download\./ })
        .map((button) => button.textContent),
    ).toEqual([
      "download.station_contents_station",
      "download.station_contents_day",
      "download.station_contents_week",
    ]);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("prints the station's notice, named after the week, day and station", async () => {
    renderPage();
    await waitFor(() => expect(download(STATION_NOTICE)).toBeEnabled());

    await userEvent.click(download(STATION_NOTICE));

    await waitFor(() =>
      expect(printed.files).toEqual([
        "commissioning.station_contents.file_name_2026_commissioning.KW41_COMMONWEEKDAYTUESDAY_Farm_shop.pdf",
      ]),
    );
    const [{ template, props }] = printed.documents;
    expect(template).toBe("StationContentsPDF");
    expect(
      (props.pages as { stationName: string; cards: unknown[] }[]).map(
        (page) => [page.stationName, page.cards.length],
      ),
    ).toEqual([["Farm shop", 2]]);
  });

  it("prints every delivery day's stations where shares are collected for the whole week", async () => {
    renderPage();
    await waitFor(() => expect(download(WEEK_NOTICE)).toBeEnabled());

    await userEvent.click(download(WEEK_NOTICE));

    await waitFor(() => expect(printed.documents).toHaveLength(1));
    expect(
      (printed.documents[0].props.pages as { key: string }[]).map(
        (page) => page.key,
      ),
    ).toEqual([
      `${TUESDAY}-${FARM_SHOP.id}`,
      `${TUESDAY}-${MARKET.id}`,
      `${FRIDAY}-${MARKET.id}`,
    ]);
  });

  it("leaves out the week's download when the week has one delivery day", async () => {
    farm.deliveryDays = [deliveryDay("day-tue", TUESDAY)];
    renderPage();
    await waitFor(() => expect(download(DAY_NOTICE)).toBeEnabled());

    expect(
      screen.queryByRole("button", { name: WEEK_NOTICE }),
    ).not.toBeInTheDocument();
  });

  it("refuses a member and loads nothing", async () => {
    session.roles = ["member"];
    renderPage();

    expect(
      await screen.findByText("auth.not_authorized.title"),
    ).toBeInTheDocument();
    await settle();
    expect(api.deliveryDays).not.toHaveBeenCalled();
    expect(api.stationContents).not.toHaveBeenCalled();
  });

  it("settles after loading instead of re-rendering in a loop", async () => {
    const { profiler } = renderPage();
    await waitFor(() => expect(download(WEEK_NOTICE)).toBeEnabled());
    await settle();

    expect(profiler.onRender.mock.calls.length).toBeLessThan(120);
  });
});
