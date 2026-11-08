/**
 * The farm the tour planning tests run against: its delivery days, as the day
 * picker offers them, and its delivery stations.
 */
import type { DeliveryStation, SharesDeliveryDay } from "@shared/api/generated/models";

export type Day = SharesDeliveryDay & { id: string };
export type Station = DeliveryStation & { id: string };

// Backend day numbers: 0 = Monday … 6 = Sunday.
export const TUESDAY: Day = {
  id: "day-tue", day_number: 1, valid_from: "2026-01-05", valid_until: null, number_of_tours: 2,
};
// Runs until 25 October; its successor takes Friday over from the 26th.
export const FRIDAY: Day = {
  id: "day-fri", day_number: 4, valid_from: "2026-01-05", valid_until: "2026-10-25",
  number_of_tours: 3,
};
export const NEXT_FRIDAY: Day = {
  id: "day-fri-next", day_number: 4, valid_from: "2026-10-26", valid_until: null,
  number_of_tours: null,
};
// A Monday that ended in the spring; the day picker still offers it, first.
export const ENDED_MONDAY: Day = {
  id: "day-mon-ended", day_number: 0, valid_from: "2025-01-06", valid_until: "2026-03-29",
  number_of_tours: 1,
};
// An earlier Tuesday, ended in January; the day picker still offers it.
export const ENDED_TUESDAY: Day = {
  id: "day-tue-ended", day_number: 1, valid_from: "2025-01-06", valid_until: "2026-01-04",
  number_of_tours: 2,
};

const WEEKDAY_KEYS: Record<number, string> = { 1: "delivery.di", 4: "delivery.fr" };
const shownDate = (isoDate: string) => isoDate.split("-").reverse().join(".");
/** What the delivery-day selector shows for a day: its weekday and validity. */
export const dayLabel = (day: Day) =>
  `${WEEKDAY_KEYS[day.day_number]}commissioning.valid_from ${shownDate(day.valid_from)}` +
  (day.valid_until ? ` commissioning.valid_until ${shownDate(day.valid_until)}` : "");

const station = (
  id: string,
  shortName: string | null,
  companyName: string | null = null,
): Station => ({ id, short_name: shortName, company_name: companyName, is_active: true });
export const MARKET_HALL = station("st-market-hall", "Market Hall");
export const BAKERY = station("st-bakery", "Bakery Lindner");
export const SCHOOL = station("st-school", "Village School");
export const TOWN_HALL = station("st-town-hall", "Town Hall");
// Has no short name, so it goes by its company name.
export const ORGANIC_SHOP = station("st-organic-shop", null, "Organic Shop Ltd");
export const MILL = station("st-mill", "Old Mill");
export const CHURCH = station("st-church", "Church Square");

export const nameOf = (of: Station) => of.short_name ?? of.company_name ?? "";

/** A station at a position of a tour, as a plan is stored and saved. */
export const at = (position: number, of: Station) => ({ position, delivery_station_id: of.id });

/** Tuesday's saved plan as the grid shows it: per tour, "position station". */
export const TUESDAY_SHOWN = [["1 Market Hall", "2 Bakery Lindner"], ["1 Village School"]];
