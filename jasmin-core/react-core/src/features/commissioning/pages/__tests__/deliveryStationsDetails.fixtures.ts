/**
 * The farm the pickup-list tests run against: its delivery days and stations,
 * the box combinations each station's members collect and what they may take.
 */
import type {
  DeliveryStation,
  PackingBoxesMatrix,
  PackingBoxesMatrixAddOn,
  PackingBoxesMatrixColumn,
  PackingBoxesMatrixRow,
  SharesDeliveryDay,
  StationMemberMatrix,
  StationMemberMatrixRow,
} from "@shared/api/generated/models";

// Backend day numbers: 0 = Monday … 6 = Sunday.
export const TUESDAY = 1;
export const FRIDAY = 4;

export const deliveryDay = (id: string, dayNumber: number): SharesDeliveryDay => ({
  id,
  day_number: dayNumber as SharesDeliveryDay["day_number"],
  valid_from: "2026-01-05",
  valid_until: null,
});

export const station = (id: string, shortName: string): DeliveryStation => ({
  id,
  short_name: shortName,
  is_active: true,
});

export const FARM_SHOP = station("st-farm-shop", "Farm shop");
export const MARKET = station("st-market", "Market");
export const SCHOOL = station("st-school", "School");
export const CHURCH_HALL = station("st-church-hall", "Church hall");

export const HONEY_M: PackingBoxesMatrixAddOn = {
  variation_id: "var-honey-m",
  size: "M",
  sort_order: 2,
  share_type_id: "st-honey",
  share_type_short_name: "Honey",
  share_type_sort_index: 0,
};
export const BREAD_L: PackingBoxesMatrixAddOn = {
  variation_id: "var-bread-l",
  size: "L",
  sort_order: 3,
  share_type_id: "st-bread",
  share_type_short_name: "Bread",
  share_type_sort_index: 1,
};

/** A vegetable box of one size with the add-ons packed into it. */
export const vegetableBox = (
  size: "S" | "M",
  count: number,
  addOns: PackingBoxesMatrixAddOn[] = [],
): PackingBoxesMatrixColumn => {
  const variation = `var-veg-${size.toLowerCase()}`;
  return {
    key: `combo_${variation}|${addOns.map((addOn) => addOn.variation_id).join("-")}`,
    base_variation_id: variation,
    base_size: size,
    base_sort_order: size === "S" ? 1 : 2,
    base_share_type_id: "st-veg",
    base_share_type_name: "Vegetables",
    base_share_type_short_name: "Veg",
    base_share_type_sort_index: 0,
    add_ons: addOns,
    count,
  };
};

/** Bread ordered without a vegetable box: a box with no base. */
export const BREAD_ONLY: PackingBoxesMatrixColumn = {
  key: `combo_none|${BREAD_L.variation_id}`,
  base_variation_id: null,
  base_size: "",
  base_sort_order: 0,
  base_share_type_id: null,
  base_share_type_name: "",
  base_share_type_short_name: "",
  base_share_type_sort_index: 1,
  add_ons: [BREAD_L],
  count: 1,
};

/** One member's row: how many boxes of each combination they collect. */
export const member = (
  id: string,
  name: string,
  boxes: [PackingBoxesMatrixColumn, number][],
): StationMemberMatrixRow =>
  ({
    id,
    name,
    ...Object.fromEntries(boxes.map(([column, count]) => [column.key, count])),
  }) as StationMemberMatrixRow;

/** A station whose members each collect one box of the same kind. */
export const oneBoxEach = (
  column: PackingBoxesMatrixColumn,
  ...members: [id: string, name: string][]
): StationMemberMatrix => ({
  columns: [column],
  rows: members.map(([id, name]) => member(id, name, [[column, 1]])),
});

export const SMALL = vegetableBox("S", 2);
export const MEDIUM_WITH_HONEY = vegetableBox("M", 2, [HONEY_M]);

export const FARM_SHOP_TUESDAY: StationMemberMatrix = {
  columns: [SMALL, MEDIUM_WITH_HONEY, BREAD_ONLY],
  rows: [
    member("m-ana", "Ana Example", [[SMALL, 1]]),
    member("m-ben", "Ben Sample", [[MEDIUM_WITH_HONEY, 2]]),
    member("m-dora", "Dora Muster", [
      [SMALL, 1],
      [BREAD_ONLY, 1],
    ]),
  ],
};
export const MARKET_TUESDAY = oneBoxEach(vegetableBox("M", 1), ["m-cleo", "Cleo Muster"]);
export const MARKET_FRIDAY = oneBoxEach(vegetableBox("S", 1), ["m-emil", "Emil Probe"]);
export const SCHOOL_FRIDAY = oneBoxEach(vegetableBox("S", 1), ["m-finn", "Finn Beispiel"]);
export const FARM_SHOP_FRIDAY = oneBoxEach(vegetableBox("M", 1), ["m-gina", "Gina Test"]);
export const FARM_SHOP_NEXT_TUESDAY = oneBoxEach(vegetableBox("S", 1), [
  "m-ana",
  "Ana Example",
]);

/** "What you may take": the amount of each article per box. */
export const CARROTS = {
  id: "row-carrots",
  share_article_id: "sa-carrots",
  share_article_name: "Carrots",
  unit: "KG",
  size: "M",
  note: "",
  [SMALL.key]: 0.5,
  [MEDIUM_WITH_HONEY.key]: 1,
} as PackingBoxesMatrixRow;
export const FARM_SHOP_TAKE: PackingBoxesMatrix = {
  columns: [SMALL, MEDIUM_WITH_HONEY],
  rows: [CARROTS],
};
export const CARROTS_ON_THE_SHEET = {
  ...CARROTS,
  unit_label: "commissioning.units.kg",
  size_label: "commissioning.medium",
};
