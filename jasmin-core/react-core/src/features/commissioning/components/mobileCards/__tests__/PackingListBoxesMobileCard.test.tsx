/**
 * The box packing list's phone cards: one per article with its amount in each
 * kind of box, in the table's order, and one with the number of boxes of each
 * kind. The amounts come through the cell text the page builds, as here: at
 * the unit's precision in the farm's number format, blank for none. The list
 * is read-only, so the cards are never buttons.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PackingBoxesMatrixColumn } from "@shared/api/generated/models";
import type {
  EditableColumnConfig,
  TableRecord,
} from "@shared/tables/BasicEditableTable/types";
import { amountCellText } from "@shared/utils/amountFormat";
import { formatNumber } from "@shared/utils/numberFormat";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import {
  PackingListBoxesCountCard,
  PackingListBoxesMobileCard,
} from "../PackingListBoxesMobileCard";

function matrixColumn(
  key: string,
  baseVariationId: string | null,
  count: number,
): PackingBoxesMatrixColumn {
  return {
    key,
    base_variation_id: baseVariationId,
    base_size: "M",
    base_sort_order: 0,
    base_share_type_id: baseVariationId ? "st-veg" : null,
    base_share_type_name: baseVariationId ? "Vegetables" : "",
    base_share_type_short_name: baseVariationId ? "Veg" : "",
    base_share_type_sort_index: 0,
    add_ons: [],
    count,
  };
}

const columns: PackingBoxesMatrixColumn[] = [
  matrixColumn("veg-s", "v-s", 12),
  matrixColumn("veg-l-fruit", "v-l", 5),
  matrixColumn("fruit-only", null, 3),
];

/** The combination columns grouped by share type, as the table heads them. */
const groups: EditableColumnConfig<TableRecord>[] = [
  {
    title: "Vegetables",
    dataIndex: "group-veg",
    children: [
      { title: "small", dataIndex: "veg-s" },
      { title: "large + fruit", dataIndex: "veg-l-fruit" },
    ],
  },
  {
    title: "Without base share",
    dataIndex: "group-none",
    children: [{ title: "Fruit box only", dataIndex: "fruit-only" }],
  },
];

function articleRow(overrides: Partial<TableRecord> = {}): TableRecord {
  return {
    key: "pl-carrots",
    id: "pl-carrots",
    share_article_name: "Carrots",
    unit: "KG",
    size: "M",
    "veg-s": 0.5,
    "veg-l-fruit": "1.25",
    "fruit-only": 1234.5,
    note: "Bundle with tops",
    ...overrides,
  };
}

/** The page's cell text for a farm with this number format. */
const amountTextFor =
  (locale: string) => (value: unknown, record: TableRecord) =>
    amountCellText(value, record.unit as string, (amount, decimals) =>
      formatNumber(amount, decimals, locale),
    );

function renderArticle(record: TableRecord = articleRow(), locale = "de-DE") {
  return render(
    <PackingListBoxesMobileCard
      record={record}
      groups={groups}
      columns={columns}
      amountText={amountTextFor(locale)}
    />,
  );
}

const card = () => document.querySelector<HTMLElement>(".mobile-card-item")!;

/** The card's figures as [label, amount, unit], in the order shown. */
function figures(): string[][] {
  return Array.from(card().querySelectorAll(".flex-baseline")).map((line) => [
    line.parentElement?.querySelector(".text-muted-xs")?.textContent ?? "",
    line.firstElementChild?.textContent ?? "",
    line.querySelector(".text-secondary")?.textContent ?? "",
  ]);
}

const KG = "commissioning.units.kg";

describe("PackingListBoxesMobileCard", () => {
  it("shows each kind of box's amount in the table's order, named by share type and combination", () => {
    renderArticle();

    expect(screen.getByText("Carrots")).toBeInTheDocument();
    expect(figures()).toEqual([
      ["Vegetables small", "0,50", KG],
      ["Vegetables large + fruit", "1,25", KG],
      ["Fruit box only", "1.234,50", KG],
    ]);
    expect(screen.getByText("Bundle with tops")).toHaveClass("text-meta");
  });

  it("writes the amounts in an English-format farm's way", () => {
    renderArticle(articleRow(), "en-US");

    expect(figures().map(([, amount]) => amount)).toEqual(["0.50", "1.25", "1,234.50"]);
  });

  it("writes amounts of a counted unit at one decimal", () => {
    renderArticle(articleRow({ unit: "PCS", "veg-s": 2, "veg-l-fruit": 0.75 }));

    expect(figures()).toEqual([
      ["Vegetables small", "2,0", "commissioning.units.pcs"],
      ["Vegetables large + fruit", "0,8", "commissioning.units.pcs"],
      ["Fruit box only", "1.234,5", "commissioning.units.pcs"],
    ]);
  });

  it("leaves out the kinds of box the article doesn't go into", () => {
    renderArticle(articleRow({ "veg-s": 0, "veg-l-fruit": null, "fruit-only": "" }));

    expect(figures()).toEqual([]);
  });

  it("keeps the kinds of box that hold some of the article", () => {
    renderArticle(articleRow({ "veg-s": undefined, "fruit-only": 0 }));

    expect(figures()).toEqual([["Vegetables large + fruit", "1,25", KG]]);
  });

  it.each([
    ["S", "commissioning.small"],
    ["L", "commissioning.large"],
  ])("labels size %s after the article name", (size, label) => {
    renderArticle(articleRow({ size }));

    expect(screen.getByText(label)).toHaveClass("text-hint");
  });

  it("shows no size label for size M and no note line without a note", () => {
    renderArticle(articleRow({ note: "" }));

    expect(card().querySelector(".text-hint")).toBeNull();
    expect(card().querySelector(".text-meta")).toBeNull();
  });

  it("is not a button", () => {
    renderArticle();

    expect(card()).not.toHaveAttribute("role");
    expect(card()).not.toHaveAttribute("tabindex");
  });
});

describe("PackingListBoxesCountCard", () => {
  it("shows the number of boxes of each kind in the table's order, without a unit", () => {
    render(<PackingListBoxesCountCard groups={groups} columns={columns} />);

    expect(screen.getByText("commissioning.box_count")).toBeInTheDocument();
    expect(figures()).toEqual([
      ["Vegetables small", "12", ""],
      ["Vegetables large + fruit", "5", ""],
      ["Fruit box only", "3", ""],
    ]);
  });
});
