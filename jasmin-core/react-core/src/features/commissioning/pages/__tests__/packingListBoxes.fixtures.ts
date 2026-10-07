/**
 * The farm the packing list of boxes tests run against: its delivery days and
 * stations, the boxes of a week and the articles packed into them.
 */
import type {
  DeliveryStation,
  GranularityCheckResponse,
  PackingBoxesMatrix,
  PackingBoxesMatrixAddOn,
  PackingBoxesMatrixColumn,
  SharesDeliveryDay,
} from "@shared/api/generated/models";

// Backend day numbers: 0 = Monday … 6 = Sunday.
export const MONDAY = 0;
export const TUESDAY = 1;
export const THURSDAY = 3;
export const FRIDAY = 4;

export const deliveryDay = (id: string, dayNumber: number, tours = 1): SharesDeliveryDay => ({
  id,
  day_number: dayNumber as SharesDeliveryDay["day_number"],
  valid_from: "2026-01-05",
  valid_until: null,
  number_of_tours: tours,
});

export const station = (id: string, shortName: string): DeliveryStation => ({
  id,
  short_name: shortName,
  is_active: true,
});

export const FARM_SHOP = station("st-farm-shop", "Farm shop");
export const MARKET = station("st-market", "Market");
export const SCHOOL = station("st-school", "School");

export const HONEY_SMALL: PackingBoxesMatrixAddOn = {
  variation_id: "var-honey-S",
  size: "S",
  sort_order: 1,
  share_type_id: "st-honey",
  share_type_short_name: "Honey",
  share_type_sort_index: 1,
};

/** A box with a base share of one size (or none) and the add-ons packed into it. */
export const box = (
  base: { shareType: "Veg" | "Honey"; size: string; sortOrder: number } | null,
  addOns: PackingBoxesMatrixAddOn[],
  count: number,
  key = `combo_${base ? `var-${base.shareType}-${base.size}` : "none"}|${addOns
    .map((addOn) => addOn.variation_id)
    .join("-")}`,
): PackingBoxesMatrixColumn => ({
  key,
  base_variation_id: base ? `var-${base.shareType}-${base.size}` : null,
  base_size: base?.size ?? "",
  base_sort_order: base?.sortOrder ?? 0,
  base_share_type_id: base ? `st-${base.shareType}` : null,
  base_share_type_name: base?.shareType ?? "",
  base_share_type_short_name: base?.shareType ?? "",
  // Vegetables first; honey, and boxes without a base share, after them.
  base_share_type_sort_index: !base || base.shareType === "Honey" ? 1 : 0,
  add_ons: addOns,
  count,
});

export const vegetables = (size: string, sortOrder: number) =>
  ({ shareType: "Veg", size, sortOrder }) as const;

export const SMALL = box(vegetables("S", 1), [], 12);
export const MEDIUM = box(vegetables("M", 2), [], 30);
export const MEDIUM_WITH_HONEY = box(vegetables("M", 2), [HONEY_SMALL], 5);
/** The box of members who take honey but no vegetables. */
export const HONEY_ONLY = box(null, [HONEY_SMALL], 2);
export const TUESDAY_COLUMNS = [SMALL, MEDIUM, MEDIUM_WITH_HONEY, HONEY_ONLY];

type MatrixRow = PackingBoxesMatrix["rows"][number];

/** One article and how much of it goes into each column's box, in order. */
export const article = (
  name: string,
  unit: string,
  size: string,
  columns: PackingBoxesMatrixColumn[],
  amounts: (number | undefined)[],
  note = "",
): MatrixRow =>
  // The amounts sit under the column keys, which the generated row type
  // leaves out.
  ({
    id: `sa-${name}_${unit}_${size}`,
    share_article_id: `sa-${name}`,
    share_article_name: name,
    unit,
    size,
    note,
    ...Object.fromEntries(columns.map((column, index) => [column.key, amounts[index]])),
  }) as MatrixRow;

export const WASH = "Wash before packing";

/** Tuesday's boxes, packed alike for every station. */
export const TUESDAY_BOXES: PackingBoxesMatrix = {
  // The server's order; the page groups and orders the columns itself.
  columns: [MEDIUM_WITH_HONEY, HONEY_ONLY, SMALL, MEDIUM],
  rows: [
    article("Carrots", "BUNCH", "M", TUESDAY_COLUMNS, [1, 2, 2, 0]),
    article("Lettuce", "PCS", "L", TUESDAY_COLUMNS, [1, 1, 1, 0], WASH),
    article("Forest honey", "PCS", "", TUESDAY_COLUMNS, [0, 0, 1, 1]),
  ],
};

/** Small and medium vegetable boxes holding a single article. */
export const boxesOf = (name: string, small: number, medium: number): PackingBoxesMatrix => {
  const columns = [box(vegetables("S", 1), [], 4), box(vegetables("M", 2), [], 6)];
  return { columns, rows: [article(name, "PCS", "", columns, [small, medium])] };
};

/** One share size in what a member may take: a variation without add-ons. */
export const shareSize = (shareType: "Veg" | "Honey", size: string, sortOrder: number) =>
  box({ shareType, size, sortOrder }, [], 0, `variation_var-${shareType}-${size}`);

export const MEMBER_COLUMNS = [shareSize("Veg", "S", 1), shareSize("Veg", "M", 2), shareSize("Honey", "S", 1)];

/** What a member of each share size takes on Tuesday. */
export const TUESDAY_MEMBER_AMOUNTS: PackingBoxesMatrix = {
  columns: MEMBER_COLUMNS,
  rows: [
    article("Lettuce", "PCS", "", MEMBER_COLUMNS, [1, 2]),
    article("Forest honey", "PCS", "", MEMBER_COLUMNS, [undefined, undefined, 1]),
  ],
};

/** Where a packing list belongs: a day, and maybe one station or one tour. */
export const scope = (
  dayNumber: number,
  { station: stationId, tour }: { station?: string; tour?: number } = {},
) => `${dayNumber}/${stationId ?? "every station"}/${tour ?? "every tour"}`;

// How consistent the planned amounts of a delivery day are.
export const ALIKE_ALL_DAY: GranularityCheckResponse = { days_ok: true, tours_ok: true };
export const ALIKE_PER_TOUR: GranularityCheckResponse = { days_ok: false, tours_ok: true };
export const PER_STATION: GranularityCheckResponse = { days_ok: false, tours_ok: false };
