/**
 * The farm the tour lists tests run against: its delivery days and share
 * sizes, the kinds of box packed for each tour and the stations they go to.
 */
import type {
  PackingBoxesMatrixAddOn,
  PackingBoxesMatrixColumn,
  SharesDeliveryDay,
  ShareTypeVariation,
  ShareTypeVariationMetadata,
  StationOverview,
  TourOverview,
  DeliveryStationsToursOverviewResponse,
} from "@shared/api/generated/models";

// Backend day numbers: 0 = Monday … 6 = Sunday.
export const TUESDAY = 1;
export const WEDNESDAY = 2;
export const FRIDAY = 4;

export const deliveryDay = (id: string, dayNumber: number, tours = 2): SharesDeliveryDay => ({
  id,
  day_number: dayNumber as SharesDeliveryDay["day_number"],
  valid_from: "2026-01-05",
  valid_until: null,
  number_of_tours: tours,
});

/** One of the farm's share sizes, as the share-size list returns it. */
export const shareSize = (
  shareType: "veg" | "honey" | "bread",
  size: ShareTypeVariation["size"],
  packedInBulk = false,
): ShareTypeVariation => ({
  id: `var-${shareType}-${size}`,
  share_type: `st-${shareType}`,
  size,
  valid_from: "2026-01-05",
  valid_until: null,
  is_packed_bulk: packedInBulk,
});

/** A share size as the tour overview describes it, with the key of its counts. */
export const shareColumn = (
  shareType: "veg" | "honey" | "bread",
  name: string,
  size: string,
): ShareTypeVariationMetadata => ({
  id: `var-${shareType}-${size}`,
  share_type_id: `st-${shareType}`,
  share_type_name: name,
  size,
  display_name: `${name} - ${size}`,
  key: `variation_var-${shareType}-${size}`,
});

export const VEGETABLES_S = shareColumn("veg", "Vegetables", "S");
export const VEGETABLES_M = shareColumn("veg", "Vegetables", "M");
export const BREAD_L = shareColumn("bread", "Bread", "L");
export const HONEY_S = shareColumn("honey", "Honey", "S");
/** The server's order of the day's share sizes. */
export const SHARE_COLUMNS = [VEGETABLES_S, VEGETABLES_M, BREAD_L, HONEY_S];

/** How many shares of each size a stop gets. */
export const shares = (vegetablesS: number, vegetablesM: number, bread: number, honey: number) => ({
  [VEGETABLES_S.key]: vegetablesS,
  [VEGETABLES_M.key]: vegetablesM,
  [BREAD_L.key]: bread,
  [HONEY_S.key]: honey,
});

export const addOn = (shareType: string, shortName: string, size: string, sortIndex: number) => ({
  variation_id: `var-${shareType}-${size}`,
  size,
  sort_order: 1,
  share_type_id: `st-${shareType}`,
  share_type_short_name: shortName,
  share_type_sort_index: sortIndex,
}) satisfies PackingBoxesMatrixAddOn;

export const HONEY_ADD_ON = addOn("honey", "Honey", "S", 1);
export const BREAD_ADD_ON = addOn("bread", "Bread", "L", 2);

export type BaseShare = {
  shareType: string;
  shortName: string;
  size: string;
  /** Orders the sizes within a share type. */
  sortOrder: number;
  /** Orders the share types. */
  sortIndex: number;
};

export const vegetables = (size: "S" | "M", sortOrder: number): BaseShare =>
  ({ shareType: "veg", shortName: "Veg", size, sortOrder, sortIndex: 0 });
export const BREAD_BASE: BaseShare =
  { shareType: "bread", shortName: "Bread", size: "L", sortOrder: 1, sortIndex: 2 };

/** A kind of box: a base share of one size (or none) and the add-ons packed into it. */
export const box = (
  base: BaseShare | null,
  addOns: PackingBoxesMatrixAddOn[],
  count: number,
): PackingBoxesMatrixColumn => {
  const baseId = base ? `var-${base.shareType}-${base.size}` : null;
  return {
    key: `combo_${baseId ?? "none"}|${addOns.map((item) => item.variation_id).join("-")}`,
    base_variation_id: baseId,
    base_size: base?.size ?? "",
    base_sort_order: base?.sortOrder ?? 0,
    base_share_type_id: base ? `st-${base.shareType}` : null,
    base_share_type_name: base?.shortName ?? "",
    base_share_type_short_name: base?.shortName ?? "",
    // Boxes without a base share come after every share type.
    base_share_type_sort_index: base?.sortIndex ?? 99,
    add_ons: addOns,
    count,
  };
};

export const SMALL = box(vegetables("S", 1), [], 22);
export const MEDIUM = box(vegetables("M", 2), [], 40);
export const MEDIUM_WITH_HONEY = box(vegetables("M", 2), [HONEY_ADD_ON], 5);
/** The box of members who take honey but no vegetables. */
export const HONEY_ONLY = box(null, [HONEY_ADD_ON], 2);
/** Bread on its own; the farm packs bread in bulk, not in the boxes. */
export const BREAD = box(BREAD_BASE, [], 7);

/** A stop of a tour and how many boxes, or shares, of each kind it gets. */
export const stop = (
  id: string,
  stopOrder: number,
  shortName: string,
  fullName: string | null,
  counts: Record<string, number>,
): StationOverview =>
  // The counts sit under one key per kind of box or share, which the
  // generated type leaves out.
  ({
    delivery_station_day_id: `sd-${id}`,
    delivery_station_id: `ds-${id}`,
    delivery_station_name: fullName,
    delivery_station_short_name: shortName,
    stop_order: stopOrder,
    capacity: null,
    pickup_time_begin: "15:00:00",
    pickup_time_end: "19:00:00",
    ...counts,
  }) as StationOverview;

export const tour = (
  tourNumber: number,
  columns: PackingBoxesMatrixColumn[],
  stations: StationOverview[],
): TourOverview => ({ tour_number: tourNumber, columns, stations });

export const overview = (
  dayNumber: number,
  tours: TourOverview[],
  { year = 2026, week = 41, variations = SHARE_COLUMNS } = {},
): DeliveryStationsToursOverviewResponse => ({
  year,
  delivery_week: week,
  day_number: dayNumber,
  delivery_day_id: `day-${dayNumber}`,
  number_of_tours: 2,
  tours,
  variations,
});

export const FARM_SHOP = stop("farm-shop", 1, "Farm shop", "Farm shop Miller", {
  [SMALL.key]: 12,
  [MEDIUM.key]: 30,
  [MEDIUM_WITH_HONEY.key]: 5,
  [BREAD.key]: 4,
  ...shares(12, 35, 4, 5),
});
export const MARKET = stop("market", 2, "Market", "Weekly market", {
  [SMALL.key]: 7,
  [MEDIUM.key]: 8,
  [HONEY_ONLY.key]: 2,
  [BREAD.key]: 3,
  ...shares(7, 8, 3, 2),
});
export const SCHOOL = stop("school", 1, "School", "Primary school", {
  [SMALL.key]: 3,
  ...shares(3, 0, 0, 0),
});
/** A station without a short name goes by its full name. */
export const LIBRARY = stop("library", 2, "", "Town library", { [MEDIUM.key]: 2, ...shares(0, 2, 0, 0) });

/** Tuesday's tours: each carries the kinds of box packed for it, in the server's order. */
export const TUESDAY_TOURS = [
  tour(1, [MEDIUM_WITH_HONEY, BREAD, SMALL, HONEY_ONLY, MEDIUM], [FARM_SHOP, MARKET]),
  tour(2, [SMALL, MEDIUM], [SCHOOL, LIBRARY]),
];

/** The same Tuesday for a farm that uploads its weekly share amounts: shares, no boxes. */
export const UPLOADED_TUESDAY_TOURS = [
  tour(1, [], [
    stop("farm-shop", 1, "Farm shop", "Farm shop Miller", shares(12, 35, 4, 5)),
    stop("market", 2, "Market", "Weekly market", shares(7, 8, 3, 2)),
  ]),
  tour(2, [], [
    stop("school", 1, "School", "Primary school", shares(3, 0, 0, 0)),
    stop("library", 2, "", "Town library", shares(0, 2, 0, 0)),
  ]),
];

/** Friday: only the first tour delivers. */
export const FRIDAY_TOURS = [
  tour(1, [SMALL, MEDIUM], [
    stop("village-hall", 1, "Village hall", "Village Hall Eastside", {
      [SMALL.key]: 6,
      [MEDIUM.key]: 9,
    }),
  ]),
];

export const NEXT_TUESDAY_TOURS = [
  tour(1, [SMALL, MEDIUM], [
    stop("farm-shop", 1, "Farm shop", "Farm shop Miller", { [SMALL.key]: 11, [MEDIUM.key]: 31 }),
  ]),
];

/** Where a tour overview belongs: a day of a week. */
export const scope = (dayNumber: number, { year = 2026, week = 41 } = {}) =>
  `${year}/${week}/${dayNumber}`;
