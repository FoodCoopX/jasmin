/**
 * Builders for the API's response models. A response type requires every
 * read-only field the serializer sends, so each builder fills those with what
 * a fresh record carries — no prices yet, deletable, no links — and takes the
 * fields a test is about, which override the defaults.
 */
import type {
  Crate,
  DeliveryNoteReseller,
  DeliveryStation,
  InvoiceReseller,
  OfferGroup,
  Plot,
  Reseller,
  Share,
  ShareArticle,
  SharesDeliveryDay,
  ShareType,
  ShareTypeVariation,
  Storage,
} from "@shared/api/generated/models";

export function makeShareArticle(
  fields: Pick<ShareArticle, "id" | "name" | "default_movement_unit"> & Partial<ShareArticle>,
): ShareArticle {
  return {
    net_price_for_boxes_kg: null,
    net_price_for_boxes_pieces: null,
    net_price_for_boxes_bunch: null,
    net_price_for_orders_kg_1: null,
    net_price_for_orders_kg_2: null,
    net_price_for_orders_kg_3: null,
    net_price_for_orders_kg_4: null,
    net_price_for_orders_pieces_1: null,
    net_price_for_orders_pieces_2: null,
    net_price_for_orders_pieces_3: null,
    net_price_for_orders_pieces_4: null,
    net_price_for_orders_bunch_1: null,
    net_price_for_orders_bunch_2: null,
    net_price_for_orders_bunch_3: null,
    net_price_for_orders_bunch_4: null,
    tax_rate: null,
    default_crate_harvest_name: null,
    default_crate_reseller_name: null,
    can_be_deleted: true,
    harvest_share: false,
    harvest_share_fruit: false,
    chicken_share: false,
    honey_share: false,
    oil_share: false,
    grain_share: false,
    bread_share: false,
    ...fields,
  };
}

export function makeStorage(fields: Pick<Storage, "id" | "name"> & Partial<Storage>): Storage {
  return { can_be_deleted: true, ...fields };
}

export function makePlot(fields: Pick<Plot, "id" | "name"> & Partial<Plot>): Plot {
  return { can_be_deleted: true, ...fields };
}

export function makeCrate(fields: Pick<Crate, "id" | "name"> & Partial<Crate>): Crate {
  return { price: null, tax_rate: null, can_be_deleted: true, ...fields };
}

export function makeShareType(
  fields: Pick<ShareType, "id" | "valid_from"> & Partial<ShareType>,
): ShareType {
  return {
    share_type_variation_sizes_in_use: "",
    variations_valid_until_max: null,
    has_open_ended_variation: false,
    can_be_deleted: true,
    ...fields,
  };
}

export function makeShareTypeVariation(
  fields: Pick<ShareTypeVariation, "id" | "share_type" | "size" | "valid_from"> &
    Partial<ShareTypeVariation>,
): ShareTypeVariation {
  return {
    active_price_per_delivery: null,
    active_price_sum_articles: null,
    active_solidarity_min_price_per_delivery: null,
    active_price_per_delivery_if_trial: null,
    active_solidarity_min_price_per_delivery_if_trial: null,
    capacity_by_week: null,
    subscriptions_valid_until_max: null,
    has_open_ended_subscription: false,
    physical_components: [],
    can_be_deleted: true,
    share_type_name: "",
    ...fields,
  };
}

/** A delivery day without stations; ``used_tours`` is null, as for a day none
 *  of whose station-days has a tour. */
export function makeSharesDeliveryDay(
  fields: Pick<SharesDeliveryDay, "id" | "day_number" | "valid_from"> & Partial<SharesDeliveryDay>,
): SharesDeliveryDay {
  return { can_be_deleted: true, delivery_stations: [], used_tours: null, ...fields };
}

export function makeDeliveryStation(
  fields: Pick<DeliveryStation, "id"> & Partial<DeliveryStation>,
): DeliveryStation {
  return {
    can_be_deleted: true,
    linked_reseller_can_be_deleted: true,
    iban_masked: "",
    iban_stored: false,
    contact: `contact-${fields.id}`,
    ...fields,
  };
}

export function makeReseller(
  fields: Pick<Reseller, "id" | "address" | "zip_code" | "city"> & Partial<Reseller>,
): Reseller {
  return {
    has_active_organic_certificate: false,
    linked_delivery_station: null,
    linked_delivery_station_can_be_deleted: true,
    linked_user_info: null,
    iban_masked: "",
    iban_stored: false,
    contact: `contact-${fields.id}`,
    can_be_deleted: true,
    ...fields,
  };
}

export function makeOfferGroup(
  fields: Pick<OfferGroup, "id" | "number"> & Partial<OfferGroup>,
): OfferGroup {
  return { reseller_names: null, is_default: false, can_be_deleted: true, ...fields };
}

/** A share without weights or a target weight, its weekday slots unset. */
export function makeShare(
  fields: Pick<
    Share,
    | "id"
    | "year"
    | "delivery_week"
    | "delivery_day"
    | "delivery_day_number"
    | "share_type_variation"
  > &
    Partial<Share>,
): Share {
  return {
    share_type_name: "",
    share_type_variation_size: "",
    share_type_variation_average_weight: null,
    changed_day_number: null,
    harvesting_day: null,
    packing_day: null,
    washing_day: null,
    cleaning_day: null,
    get_current_stock_day: null,
    ...fields,
  };
}

/** A draft invoice without lines: no number, date or file yet, nothing owed. */
export function makeInvoiceReseller(fields: Partial<InvoiceReseller> = {}): InvoiceReseller {
  return {
    id: "invoice-1",
    line_items: [],
    crate_items: [],
    sum_netto: "0.00",
    sum_brutto: "0.00",
    reseller_name: null,
    reseller_name2: null,
    reseller_address: null,
    reseller_zip: null,
    reseller_city: null,
    reseller_country: null,
    reseller_uid: null,
    reseller_payment_terms_in_days: null,
    reseller_early_payment_discount_percent: null,
    reseller_early_payment_discount_days: null,
    invoice_number: "",
    invoice_date: null,
    corresponding_delivery_notes: null,
    cancels_invoice_number: null,
    created_at: "2026-10-05T08:00:00Z",
    is_finalized: false,
    finalized_at: null,
    prefix: "",
    number: null,
    date: null,
    file: null,
    xml_file: null,
    document_hash: null,
    recipient_snapshot: null,
    has_been_sent_to_reseller_at: null,
    has_been_sent_to_accounting_at: null,
    document_type: "invoice",
    correction_reason: null,
    created_by: null,
    finalized_by: null,
    reseller: "reseller-1",
    cancels_invoice: null,
    cancelled_by_invoice: null,
    tax_breakdown: [],
    created_by_name: null,
    ...fields,
  };
}

/** A draft delivery note without lines: no number, date or file yet. */
export function makeDeliveryNoteReseller(
  fields: Partial<DeliveryNoteReseller> = {},
): DeliveryNoteReseller {
  return {
    id: "delivery-note-1",
    line_items: [],
    crate_items: [],
    sum_netto: "0.00",
    sum_brutto: "0.00",
    reseller_name: null,
    reseller_address: "",
    reseller_zip: "",
    reseller_city: "",
    reseller_country: null,
    delivery_note_number: "",
    delivery_note_date: null,
    order_number: "",
    order_date: null,
    order_prefix: "",
    created_at: "2026-10-05T08:00:00Z",
    is_finalized: false,
    finalized_at: null,
    prefix: "",
    number: null,
    date: null,
    file: null,
    has_been_sent_to_reseller_at: null,
    created_by: null,
    finalized_by: null,
    order: "order-1",
    tax_breakdown: [],
    created_by_name: null,
    ...fields,
  };
}
