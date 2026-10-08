/**
 * The plan the long-term planning tests run against: the share types and
 * sizes of the harvest share, its articles and sellers, and the planned rows.
 */
import {
  ShareTypeEnum,
  type DefaultShareContentResponse,
  type Reseller,
  type ShareArticle,
  type ShareType,
  type ShareTypeVariation,
  type UnitEnum,
} from "@shared/api/generated/models";

export const HARVEST = ShareTypeEnum.HARVEST_SHARE;
export const HONEY = ShareTypeEnum.HONEY_SHARE;

const shareType = (option: ShareTypeEnum, fields: Partial<ShareType>): ShareType => ({
  id: `st-${option}`, share_option: option, valid_from: "2026-01-05", valid_until: null, ...fields,
});
export const HARVEST_SHARE_TYPE = shareType(HARVEST, { needs_complex_planning: true });
export const HONEY_SHARE_TYPE = shareType(HONEY, { needs_complex_planning: false, is_additional_share_type: true });

// The two physical share sizes, their average weights and active subscribers.
export const VARIATIONS: ShareTypeVariation[] = [
  { id: "var-small", size: "S", average_weight: "2.00", share_type: "st-HARVEST_SHARE", valid_from: "2026-01-05" },
  { id: "var-large", size: "L", average_weight: "4.00", share_type: "st-HARVEST_SHARE", valid_from: "2026-01-05" },
];
export const SUBSCRIBERS: Record<string, number> = { "var-small": 20, "var-large": 10 };

export const article = (id: string, name: string, unit: UnitEnum, extra: Partial<ShareArticle> = {}): ShareArticle => ({
  id, name, default_movement_unit: unit, is_active: true, is_purchased: false,
  share_option_list: [HARVEST], ...extra,
});
export const ARTICLES: ShareArticle[] = [
  article("art-carrot", "Carrots", "KG"),
  article("art-apple", "Apples", "KG", { is_purchased: true }),
  article("art-kohlrabi", "Kohlrabi", "PCS"),
  article("art-beet", "Beetroot", "KG"),
  article("art-pear", "Pears", "KG", { is_purchased: true }),
  article("art-lettuce", "Lettuce", "PCS"),
  article("art-honey", "Forest honey", "PCS", { is_purchased: true, share_option_list: [HONEY] }),
];
export const SELLERS: Reseller[] = [
  { id: "seller-orchard", company_name: "Orchard Co", address: "Hill 1", zip_code: "3400", city: "Krems" },
];

export type PlanRow = DefaultShareContentResponse & Record<`amount_${string}`, string>;

/** The backend's total: subscribers × per-share amount × delivery weeks. */
function neededAmount(row: Record<string, unknown>): string {
  const first = Number(row.range_1);
  let weeks = 0;
  for (let week = first; week <= Number(row.range_2); week++) {
    if (row.only_odd_weeks && week % 2 === 0) continue;
    if (row.only_even_weeks && week % 2 === 1) continue;
    if (row.only_every_three_weeks && (week - first) % 3 !== 0) continue;
    weeks += 1;
  }
  const total = Object.entries(SUBSCRIBERS).reduce(
    (sum, [id, count]) => sum + count * Number(row[`amount_${id}`] ?? 0) * weeks,
    0,
  );
  return total.toFixed(2);
}

export function planRow(
  fields: Partial<PlanRow> & Pick<PlanRow, "share_article" | "range_1" | "range_2">,
): PlanRow {
  const row = {
    year: 2026, share_option: HARVEST, unit: "KG", size: "M", note: null, seller: null,
    only_odd_weeks: false, only_even_weeks: false, only_every_three_weeks: false,
    ...fields,
  };
  return {
    ...row,
    id: `${row.year}_${row.share_article}_${row.unit}_${row.size}`,
    seller_name: SELLERS.find((seller) => seller.id === row.seller)?.company_name ?? null,
    needed_amount: neededAmount(row),
  } as PlanRow;
}

// 20 × 3 kg + 10 × 5.5 kg a week for ten weeks: 1,150 kg.
export const CARROTS = planRow({
  share_article: "art-carrot", range_1: 20, range_2: 29, note: "Sow under fleece",
  "amount_var-small": "3.000", "amount_var-large": "5.500",
});
// Bought in from the orchard, in the even weeks 36 to 44 only: 300 kg.
export const APPLES = planRow({
  share_article: "art-apple", range_1: 36, range_2: 44, only_even_weeks: true,
  seller: "seller-orchard", "amount_var-small": "1.500", "amount_var-large": "3.000",
});
// Counted in pieces, every third week from 24: weeks 24, 27, 30 and 33.
export const KOHLRABI = planRow({
  share_article: "art-kohlrabi", unit: "PCS", range_1: 24, range_2: 35, only_every_three_weeks: true,
  "amount_var-small": "4.000", "amount_var-large": "6.000",
});
// Thirteen weeks of 20 × 2 kg + 10 × 4 kg: 1,040 kg.
export const CARROTS_2025 = planRow({
  year: 2025, share_article: "art-carrot", range_1: 18, range_2: 30,
  "amount_var-small": "2.000", "amount_var-large": "4.000",
});
