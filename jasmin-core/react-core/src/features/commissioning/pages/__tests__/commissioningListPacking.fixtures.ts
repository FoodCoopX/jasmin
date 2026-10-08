/**
 * The farm the packing commissioning list tests run against: its share types
 * and sizes, delivery days and the planned articles of a few weeks.
 */
import type {
  HarvestSharePlanningRow,
  ShareType,
  ShareTypeEnum,
  ShareTypeVariation,
  SharesDeliveryDay,
} from "@shared/api/generated/models";

export const VEGETABLES: ShareTypeEnum = "HARVEST_SHARE";
export const FRUIT: ShareTypeEnum = "HARVEST_SHARE_FRUIT";

export const shareType = (
  id: string,
  name: string,
  shareOption: ShareTypeEnum | null,
): ShareType => ({ id, name, share_option: shareOption, valid_from: "2026-01-05" });

/** A share size of a share type, packed in bulk or in boxes. */
export const variation = (
  shareTypeId: string,
  size: ShareTypeVariation["size"],
  packing: "bulk" | "boxes",
): ShareTypeVariation => ({
  id: `var-${shareTypeId}-${size}`,
  share_type: shareTypeId,
  size,
  is_packed_bulk: packing === "bulk",
  valid_from: "2026-01-05",
});

export const VEGETABLE_SHARE = shareType("st-veg", "Vegetables", VEGETABLES);
export const FRUIT_SHARE = shareType("st-fruit", "Fruit", FRUIT);

// Backend day numbers: 0 = Monday … 6 = Sunday.
export const deliveryDay = (id: string, dayNumber: number): SharesDeliveryDay => ({
  id,
  day_number: dayNumber as SharesDeliveryDay["day_number"],
  valid_from: "2026-01-05",
  valid_until: null,
});

export type PlanningRow = HarvestSharePlanningRow & Record<string, unknown>;

/**
 * One planned article: how much of it the shares of each delivery day need,
 * summed over every station, and the percentage packed on top of that
 * against spoilage.
 */
export const planned = (
  name: string,
  unit: string,
  size: string,
  perDay: Record<string, number | string | null>,
  bufferPercent = 0,
): PlanningRow => ({
  id: `sc-${name}-${unit}-${size}`,
  year: 2026,
  delivery_week: 41,
  share_article: `sa-${name}`,
  share_article_name: name,
  unit,
  size,
  percentage_added_to_commissioning_list_packing: bufferPercent,
  ...Object.fromEntries(
    Object.entries(perDay).map(([dayId, amount]) => [`day_${dayId}_planned_amount`, amount]),
  ),
});

export const WEEK_41_VEGETABLES = [
  // Half as much again on top: 18 on Tuesday, 12 on Friday.
  planned("Carrots", "BUNCH", "M", { "day-tue": 12, "day-fri": 8 }, 50),
  planned("Lettuce", "PCS", "L", { "day-tue": 30 }),
  // Two and a half kilos are packed as three.
  planned("Potatoes", "KG", "S", { "day-tue": "2.500", "day-fri": "0.000" }),
  planned("Radishes", "BUNCH", "S", { "day-tue": 0, "day-fri": 10 }),
  planned("Kale", "KG", "M", { "day-tue": null, "day-fri": null }),
];
// A quarter on top: 30.
export const WEEK_41_FRUIT = [planned("Apples", "KG", "M", { "day-tue": 24 }, 25)];
export const WEEK_42_VEGETABLES = [planned("Beetroot", "BUNCH", "M", { "day-tue": 6, "day-fri": 4 })];
export const WEEK_40_VEGETABLES = [planned("Spinach", "KG", "M", { "day-tue": 4 })];

/** Where a plan belongs: a share option in a week. */
export const plan = (shareOption: string, { year = 2026, week = 41 } = {}) =>
  `${year}/${week}/${shareOption}`;

/** The plan request of a share option, for week 41 of 2026 unless told otherwise. */
export const planningRequest = (
  shareOption: string,
  { year = 2026, week = 41, isPast = false } = {},
) => ({
  year,
  delivery_week: week,
  share_option: shareOption,
  is_past: isPast,
});
