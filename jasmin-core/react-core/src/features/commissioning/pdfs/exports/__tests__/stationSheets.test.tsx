/**
 * The two sheets printed for a delivery station: the members' notice
 * (StationContentsPDF) and the pickup list (DeliveryStationDetailsPDF).
 */
import { render, screen, within } from "@testing-library/react";
import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

import type {
  PackingBoxesMatrixAddOn,
  PackingBoxesMatrixColumn,
} from "@shared/api/generated/models";
import type { StationContentsPage } from "@features/commissioning/utils/stationContents";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@react-pdf/renderer", async (importOriginal) => {
  const { pdfDomPrimitives } =
    await import("@features/commissioning/pdfs/__tests__/pdfDomPrimitives");
  return {
    ...(await importOriginal<typeof import("@react-pdf/renderer")>()),
    ...pdfDomPrimitives(),
  };
});

import { styleOf } from "@features/commissioning/pdfs/__tests__/pdfDomPrimitives";
import DeliveryStationDetailsPDF from "../DeliveryStationDetailsPDF";
import { pdfTheme } from "../pdfTheme";
import StationContentsPDF from "../StationContentsPDF";

const t = ((key: string, options?: { count?: number }) =>
  options?.count === undefined
    ? key
    : `${key}:${options.count}`) as unknown as TFunction;

const TENANT = {
  name: "Green Acres",
  logoUrl: null,
  email: "office@example.test",
  phone: "+49 30 1234567",
};
const [GREEN, WARM] = pdfTheme.colors.shareTints;

const textOf = (container: HTMLElement) => container.textContent ?? "";

// ── The members' notice ─────────────────────────────────────────────────────

const noticePage = (marksKind: boolean): StationContentsPage => ({
  key: "1-farm-shop",
  stationName: "Farm shop",
  dateLabel: "Tuesday, 06.10.2026 · KW 41",
  marksKind,
  organicControlNumber: "",
  cards: [
    {
      key: "var-veg-s",
      shareTypeName: "Vegetables",
      sizeLabel: "S",
      loose: false,
      tint: 0,
      lines: [
        {
          key: "carrots",
          name: "Carrots",
          sizeLabel: "",
          amount: "500",
          unit: "g",
          note: "",
          sellerName: "",
          organicStatus: null,
        },
        {
          key: "leek",
          name: "Leek",
          sizeLabel: "large",
          amount: "2",
          unit: "pcs",
          note: "The thin ones",
          sellerName: "",
          organicStatus: null,
        },
      ],
    },
    {
      key: "var-fruit",
      shareTypeName: "Fruit",
      sizeLabel: "",
      loose: true,
      tint: 1,
      lines: [
        {
          key: "apples",
          name: "Apples",
          sizeLabel: "",
          amount: "1,5",
          unit: "kg",
          note: "",
          sellerName: "",
          organicStatus: null,
        },
      ],
    },
  ],
});

/** A card's outer view, found by its share type's name. */
function cardOf(container: HTMLElement, shareTypeName: string): HTMLElement {
  const card = Array.from(
    container.querySelectorAll<HTMLElement>("[data-wrap='false']"),
  ).find((element) => element.textContent?.includes(shareTypeName));
  if (!card) throw new Error(`No card for ${shareTypeName}`);
  return card;
}

describe("StationContentsPDF", () => {
  it("heads the page with the station and its day and prints a card per share with what one share holds", () => {
    const { container } = render(
      <StationContentsPDF pages={[noticePage(false)]} tenant={TENANT} t={t} />,
    );

    expect(
      screen.getByText("commissioning.station_contents.pill"),
    ).toBeInTheDocument();
    expect(screen.getByText("Farm shop")).toBeInTheDocument();
    expect(screen.getByText("Tuesday, 06.10.2026 · KW 41")).toBeInTheDocument();
    const vegetables = cardOf(container, "Vegetables");
    expect(within(vegetables).getByText("S")).toBeInTheDocument();
    expect(
      within(vegetables).getByText(
        "commissioning.station_contents.article_count:2",
      ),
    ).toBeInTheDocument();
    expect(textOf(vegetables)).toContain("Carrots500 g");
    expect(textOf(vegetables)).toContain("Leek · large");
    expect(within(vegetables).getByText("The thin ones")).toBeInTheDocument();
    expect(styleOf(vegetables.firstElementChild).backgroundColor).toBe(GREEN);
    expect(
      styleOf(cardOf(container, "Fruit").firstElementChild).backgroundColor,
    ).toBe(WARM);
  });

  it("says boxed or loose only when the page marks it", () => {
    const { container, rerender } = render(
      <StationContentsPDF pages={[noticePage(false)]} tenant={TENANT} t={t} />,
    );
    expect(textOf(container)).not.toContain(
      "commissioning.station_contents.in_box",
    );
    expect(textOf(container)).not.toContain(
      "commissioning.station_contents.take_yourself",
    );

    rerender(
      <StationContentsPDF pages={[noticePage(true)]} tenant={TENANT} t={t} />,
    );

    // The legend explains both kinds; each card carries its own.
    expect(
      screen.getByText("commissioning.station_contents.in_box_hint", {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("commissioning.station_contents.take_yourself_hint", {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(
      within(cardOf(container, "Vegetables")).getByText(
        "commissioning.station_contents.in_box",
      ),
    ).toBeInTheDocument();
    expect(
      within(cardOf(container, "Fruit")).getByText(
        "commissioning.station_contents.take_yourself",
      ),
    ).toBeInTheDocument();
  });

  it("puts a circle to tick before each line of a loose share, without marking it loose when every share is", () => {
    const everythingLoose = {
      ...noticePage(false),
      cards: noticePage(false).cards.map((card) => ({ ...card, loose: true })),
    };
    const { container } = render(
      <StationContentsPDF pages={[everythingLoose]} tenant={TENANT} t={t} />,
    );

    const ticks = (card: HTMLElement) =>
      Array.from(card.querySelectorAll("[data-pdf='view']")).filter(
        (view) => styleOf(view).borderRadius === 4.5,
      );
    expect(ticks(cardOf(container, "Vegetables"))).toHaveLength(2);
    expect(ticks(cardOf(container, "Fruit"))).toHaveLength(1);
    expect(textOf(container)).not.toContain(
      "commissioning.station_contents.take_yourself",
    );
  });

  it("tags organic articles and names the control number below the cards", () => {
    const certified = {
      ...noticePage(false),
      organicControlNumber: "DE-ÖKO-123",
      cards: noticePage(false).cards.map((card) => ({
        ...card,
        lines: card.lines.map((line) =>
          line.name === "Leek"
            ? { ...line, organicStatus: "organic" as const }
            : line,
        ),
      })),
    };
    const { container } = render(
      <StationContentsPDF pages={[certified]} tenant={TENANT} t={t} />,
    );

    expect(textOf(cardOf(container, "Vegetables"))).toContain(
      "Leek · large  commissioning.organic.organic",
    );
    expect(
      screen.getByText(
        "commissioning.organic.organic: commissioning.organic.organic_footer, DE-ÖKO-123",
      ),
    ).toBeInTheDocument();
    expect(textOf(container)).not.toContain(
      "commissioning.organic.in_conversion_footer",
    );
  });

  it("names the seller of a bought-in article in brackets", () => {
    const withSeller = {
      ...noticePage(false),
      cards: noticePage(false).cards.map((card) => ({
        ...card,
        lines: card.lines.map((line) =>
          line.name === "Apples"
            ? { ...line, sellerName: "Obsthof Huber" }
            : line,
        ),
      })),
    };
    const { container } = render(
      <StationContentsPDF pages={[withSeller]} tenant={TENANT} t={t} />,
    );

    expect(textOf(cardOf(container, "Fruit"))).toContain(
      "Apples (Obsthof Huber)",
    );
  });

  it("names no control number on a page without organic articles", () => {
    const { container } = render(
      <StationContentsPDF
        pages={[{ ...noticePage(false), organicControlNumber: "DE-ÖKO-123" }]}
        tenant={TENANT}
        t={t}
      />,
    );

    expect(textOf(container)).not.toContain("DE-ÖKO-123");
  });

  it("asks members to report what is missing, but only with a way to reach the farm", () => {
    const { rerender } = render(
      <StationContentsPDF pages={[noticePage(false)]} tenant={TENANT} t={t} />,
    );
    expect(
      screen.getByText("commissioning.station_contents.missing"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("+49 30 1234567 · office@example.test", {
        exact: false,
      }),
    ).toBeInTheDocument();

    rerender(
      <StationContentsPDF
        pages={[noticePage(false)]}
        tenant={{ ...TENANT, email: "", phone: "" }}
        t={t}
      />,
    );
    expect(
      screen.queryByText("commissioning.station_contents.missing"),
    ).not.toBeInTheDocument();
  });
});

// ── The pickup list ─────────────────────────────────────────────────────────

const HONEY: PackingBoxesMatrixAddOn = {
  variation_id: "var-honey",
  size: "ONE_SIZE",
  sort_order: 1,
  share_type_id: "st-honey",
  share_type_short_name: "Honey",
  share_type_sort_index: 0,
  is_packed_bulk: false,
};

const vegetableColumn = (
  size: string,
  count: number,
  { loose = false, addOns = [] as PackingBoxesMatrixAddOn[] } = {},
): PackingBoxesMatrixColumn => ({
  key: `combo_veg-${size}|${addOns.map((addOn) => addOn.variation_id).join("-")}`,
  base_variation_id: `veg-${size}`,
  base_size: size,
  base_sort_order: 1,
  base_share_type_id: "st-veg",
  base_share_type_name: "Vegetables",
  base_share_type_short_name: "Veg",
  base_share_type_sort_index: 0,
  base_is_packed_bulk: loose,
  add_ons: addOns,
  count,
});

const SMALL = vegetableColumn("S", 2);
const MEDIUM_HONEY = vegetableColumn("M", 1, { addOns: [HONEY] });
const LARGE_LOOSE = vegetableColumn("L", 1, { loose: true });

const pickupPage = {
  stationName: "Farm shop",
  dateLabel: "Tuesday, 06.10.2026 · KW 41",
  columns: [SMALL, MEDIUM_HONEY, LARGE_LOOSE],
  rows: [
    { id: "ana", name: "Ana Example", [SMALL.key]: 1 },
    { id: "anton", name: "Anton Muster", [MEDIUM_HONEY.key]: 1 },
    { id: "bea", name: "Bea Beispiel", [SMALL.key]: 1, [LARGE_LOOSE.key]: 1 },
  ],
};

/** Each member's row as printed: initial, name, boxes per column. */
const memberRows = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLElement>("[data-wrap='false']"),
  ).map((row) =>
    Array.from(row.querySelectorAll("[data-pdf='text']")).map(
      (cell) => cell.textContent ?? "",
    ),
  );

function renderPickupList(packingMode: "BOXES" | "BULK" | "MIXED" = "BOXES") {
  return render(
    <DeliveryStationDetailsPDF
      pages={[pickupPage]}
      packingMode={packingMode}
      tints={{ "st-veg": 0 }}
      tenant={TENANT}
      t={t}
    />,
  );
}

describe("DeliveryStationDetailsPDF", () => {
  it("heads the page with the station and its day and prints each member's boxes, with the first of each initial lettered", () => {
    const { container } = renderPickupList();

    expect(
      screen.getByText("commissioning.pickup_sheet.pill"),
    ).toBeInTheDocument();
    expect(screen.getByText("Farm shop")).toBeInTheDocument();
    expect(screen.getByText("Tuesday, 06.10.2026 · KW 41")).toBeInTheDocument();
    expect(memberRows(container)).toEqual([
      ["A", "Ana Example", "1", "", ""],
      ["", "Anton Muster", "", "1", ""],
      ["B", "Bea Beispiel", "1", "", "1"],
      // The boxes of each combination at the station.
      ["commissioning.pickup_sheet.total", "2", "1", "1"],
    ]);
  });

  it("numbers a station's pages", () => {
    renderPickupList();
    expect(screen.getByText("common.page 1 common.of 2")).toBeInTheDocument();
  });

  it("numbers the pages even where the farm gives no contact", () => {
    const { container } = render(
      <DeliveryStationDetailsPDF
        pages={[pickupPage]}
        packingMode="BOXES"
        tints={{ "st-veg": 0 }}
        tenant={{ ...TENANT, email: "", phone: "" }}
        t={t}
      />,
    );

    expect(textOf(container)).toContain("common.page 1 common.of 2");
    expect(textOf(container)).not.toContain(
      "commissioning.pickup_sheet.missing",
    );
  });

  it("labels each column with its size and add-ons under the share type's tint", () => {
    const { container } = renderPickupList();

    const header = Array.from(
      container.querySelectorAll<HTMLElement>("[data-fixed='true']"),
    )[1];
    expect(within(header).getByText("commissioning.S")).toBeInTheDocument();
    expect(within(header).getByText("commissioning.M")).toBeInTheDocument();
    // An add-on in one size shows no size.
    expect(within(header).getByText("+ Honey")).toBeInTheDocument();
    const groupBand = within(container)
      .getByText("Veg")
      .closest("[data-pdf='view']");
    expect(styleOf(groupBand).backgroundColor).toBe(GREEN);
  });

  it("counts a combination without a base as loose when all its add-ons are", () => {
    const breadOnly: PackingBoxesMatrixColumn = {
      ...vegetableColumn("S", 1),
      key: "combo_none|bread",
      base_variation_id: null,
      base_size: "",
      base_share_type_id: null,
      base_share_type_short_name: "",
      add_ons: [
        {
          ...HONEY,
          variation_id: "bread",
          share_type_short_name: "Bread",
          is_packed_bulk: true,
        },
      ],
    };
    render(
      <DeliveryStationDetailsPDF
        pages={[
          {
            ...pickupPage,
            columns: [SMALL, breadOnly],
            rows: [{ id: "ana", name: "Ana Example", [breadOnly.key]: 1 }],
          },
        ]}
        packingMode="MIXED"
        tints={{}}
        tenant={TENANT}
        t={t}
      />,
    );

    expect(
      screen.getAllByText("commissioning.pickup_sheet.box_chip"),
    ).toHaveLength(1);
    expect(
      screen.getAllByText("commissioning.pickup_sheet.loose_chip"),
    ).toHaveLength(1);
    expect(screen.getByText("+ Bread")).toBeInTheDocument();
  });

  it("says which columns are boxes and which loose only when the farm packs both ways", () => {
    const { container, unmount } = renderPickupList("BOXES");
    expect(textOf(container)).not.toContain(
      "commissioning.pickup_sheet.box_hint",
    );
    expect(textOf(container)).not.toContain(
      "commissioning.pickup_sheet.loose_chip",
    );
    unmount();

    renderPickupList("MIXED");

    expect(
      screen.getByText("commissioning.pickup_sheet.box_hint", { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("commissioning.pickup_sheet.loose_hint", {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("commissioning.pickup_sheet.box_chip"),
    ).toHaveLength(2);
    expect(
      screen.getAllByText("commissioning.pickup_sheet.loose_chip"),
    ).toHaveLength(1);
  });
});
