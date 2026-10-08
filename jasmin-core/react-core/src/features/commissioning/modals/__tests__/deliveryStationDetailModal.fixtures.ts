/**
 * The station the station-day dialog tests open: the farm's delivery days and
 * the station's days on them, as the server holds them.
 */
import type {
  DeliveryStationDay,
  SharesDeliveryDay,
} from "@shared/api/generated/models";

export const NOW = new Date(2026, 9, 6, 12, 0);

export type Station = { id: string; short_name?: string; contact?: { name?: string } };

export const STATION: Station = {
  id: "station-mill",
  short_name: "Mill",
  contact: { name: "Old Mill" },
};

export const deliveryDay = (
  id: string,
  day_number: SharesDeliveryDay["day_number"],
  valid_from: string,
): SharesDeliveryDay => ({ id, day_number, valid_from, valid_until: null });

// The farm delivers on Tuesdays and Thursdays and adds Saturdays in November.
export const DELIVERY_DAYS = [
  deliveryDay("sdd-tue", 1, "2025-01-06"),
  deliveryDay("sdd-thu", 3, "2026-01-12"),
  deliveryDay("sdd-sat", 5, "2026-11-02"),
];

export function stationDay(
  overrides: Partial<DeliveryStationDay> & { id: string },
): DeliveryStationDay {
  return {
    delivery_station: STATION.id,
    delivery_day: "sdd-tue",
    valid_from: "2025-12-29",
    valid_until: null,
    capacity: 20,
    capacity_by_week: {},
    pickup_time_begin: "14:00:00",
    pickup_time_end: "18:30:00",
    additional_pickup_days: 0,
    special_instructions: "",
    can_be_deleted: true,
    ...overrides,
  };
}

// The station's Tuesday as it ran last year, closed.
export const TUESDAY_2025 = stationDay({
  id: "sd-tue-2025",
  valid_from: "2025-01-06",
  valid_until: "2025-12-28",
  capacity: 18,
  pickup_time_begin: "15:00:00",
  pickup_time_end: "18:00:00",
  can_be_deleted: false,
});
// The station's current Tuesday, booked into December; week 40 is already over.
export const TUESDAY = stationDay({
  id: "sd-tue",
  capacity: 20,
  capacity_by_week: {
    "2026-40": { occupied: 19, free: 1 },
    "2026-41": { occupied: 12, free: 8 },
    "2026-43": { occupied: 14, free: 6 },
    "2026-50": { occupied: 9, free: 11 },
  },
  additional_pickup_days: 1,
  special_instructions: "<p>Key in the mailbox.</p>",
  can_be_deleted: false,
});
// A Thursday that ends this month and has nothing booked.
export const THURSDAY = stationDay({
  id: "sd-thu",
  delivery_day: "sdd-thu",
  valid_from: "2026-01-19",
  valid_until: "2026-10-25",
  capacity: 10,
  capacity_by_week: null,
  pickup_time_begin: null,
  pickup_time_end: null,
  additional_pickup_days: null,
  special_instructions: null,
});
