/**
 * The farm the share article list tests run against: its share options and
 * crates, and the articles the server holds at the start of each test.
 */
import type { ActiveShareOptions, Crate, ShareArticle, ShareOptionItem } from "@shared/api/generated/models";

type Row = Record<string, unknown>;

export const SHARE_OPTION_VALUES = [
  "HARVEST_SHARE", "HARVEST_SHARE_FRUIT", "CHICKEN_SHARE", "HONEY_SHARE", "OIL_SHARE", "GRAIN_SHARE", "BREAD_SHARE",
];
export const SHARE_OPTIONS: ShareOptionItem[] = SHARE_OPTION_VALUES.map((value) => ({ value, label: value }));
// The farm runs vegetable and honey shares, no fruit share and none of the rest.
export const ACTIVE_SHARE_OPTIONS: ActiveShareOptions = {
  HARVEST_SHARE: true, HARVEST_SHARE_FRUIT: false, CHICKEN_SHARE: false, HONEY_SHARE: true,
  OIL_SHARE: false, GRAIN_SHARE: false, BREAD_SHARE: false, fruit_and_veg_shares_are_separate: false,
};

export const EURO_CRATE: Crate = { id: "crate-e2", name: "Euro crate E2", short_name: "E2", is_active: true };
// Without a short name, so it goes by its full name.
export const HARVEST_BIN: Crate = { id: "crate-bin", name: "Harvest bin", short_name: null, is_active: true };
export const CRATES = [EURO_CRATE, HARVEST_BIN];

export const optionFields = (options: string[]) => ({
  share_option: options[0] ?? null, share_option2: options[1] ?? null, share_option3: options[2] ?? null,
});

/** An article as the data list carries it: one flag per share option, and the
 *  short names of its crates. */
export function asListed(fields: Row): ShareArticle {
  const options = [fields.share_option, fields.share_option2, fields.share_option3];
  const shortName = (id: unknown) => CRATES.find((crate) => crate.id === id)?.short_name ?? null;
  return {
    ...fields,
    ...Object.fromEntries(SHARE_OPTION_VALUES.map((value) => [value.toLowerCase(), options.includes(value)])),
    default_crate_harvest_name: shortName(fields.default_crate_harvest),
    default_crate_reseller_name: shortName(fields.default_crate_reseller),
  } as ShareArticle;
}

export const BLANK_ARTICLE: Row = {
  is_active: true, is_extra: false, article_number: null, description: null, is_purchased: false,
  is_sold_to_resellers: false, for_markets: false, organic_status: "conventional", default_movement_unit: "KG",
  default_commissioning_unit: null, kg_per_piece_S: null, kg_per_piece_M: null, kg_per_piece_L: null,
  pieces_per_kg_S: null, pieces_per_kg_M: null, pieces_per_kg_L: null, default_packing_station: null,
  percentage_added_to_bulk_packing_list: null, percentage_added_to_commissioning_list_packing: 0,
  default_kg_per_pu_harvest: null, default_pieces_per_pu_harvest: null, default_bunches_per_pu_harvest: null,
  default_kg_per_pu_reseller: null, default_pieces_per_pu_reseller: null, default_bunches_per_pu_reseller: null,
  default_kg_per_pu_purchase: null, default_pieces_per_pu_purchase: null, default_bunches_per_pu_purchase: null,
  default_crate_harvest: null, default_crate_reseller: null, can_be_deleted: true,
};

export const article = (id: string, name: string, options: string[], fields: Row = {}) =>
  asListed({ ...BLANK_ARTICLE, id, name, ...optionFields(options), ...fields });

// What the page appends to the name of an article the farm buys in.
export const PURCHASED_SUFFIX = "commissioning.purchased_name_suffix";
export const LEMONS_NAME = `Lemons ${PURCHASED_SUFFIX}`;

// In the vegetable share and in the fruit share, which the farm doesn't run now.
export const APPLES = article("article-apples", "Apples", ["HARVEST_SHARE", "HARVEST_SHARE_FRUIT"], {
  kg_per_piece_M: "0.200",
});
// Planned into shares already, so the backend protects it.
export const CARROTS = article("article-carrots", "Carrots", ["HARVEST_SHARE"], {
  article_number: "A-100", description: "Washed, with greens", organic_status: "organic",
  is_sold_to_resellers: true, for_markets: true, can_be_deleted: false,
  kg_per_piece_S: "0.080", kg_per_piece_M: "0.150", kg_per_piece_L: "0.250", pieces_per_kg_M: "7.000",
  default_packing_station: 2, percentage_added_to_bulk_packing_list: 10,
  percentage_added_to_commissioning_list_packing: 5, default_kg_per_pu_harvest: "12.500",
  default_crate_harvest: EURO_CRATE.id, default_commissioning_unit: "KG",
  default_kg_per_pu_reseller: "10.000", default_crate_reseller: HARVEST_BIN.id,
});
export const FOREST_HONEY = article("article-honey", "Forest honey", ["HONEY_SHARE"], {
  default_movement_unit: "PCS", is_sold_to_resellers: true,
});
// Bought in; still carries the harvest values from before it was.
export const LEMONS = article("article-lemons", LEMONS_NAME, ["HARVEST_SHARE"], {
  is_purchased: true, organic_status: "in_conversion", default_kg_per_pu_purchase: "15.000",
  default_pieces_per_pu_purchase: "80.000", default_kg_per_pu_harvest: "9.000",
  default_crate_harvest: EURO_CRATE.id,
});
// No longer grown.
export const RADISHES = article("article-radishes", "Radishes", ["HARVEST_SHARE"], {
  default_movement_unit: "BUNCH", is_active: false,
});

/** A rejected request as axios hands it over, carrying the server's body. */
export const httpError = (status: number, data: Row) =>
  Object.assign(new Error(`Request failed with status ${status}`), { isAxiosError: true, response: { status, data } });
