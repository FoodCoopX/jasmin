import type { TFunction } from "i18next";
import type {
  OddDefaults,
  OrderDays,
} from "@features/commissioning/hooks/useOrdersData";
import type { WashingCleaningVisibility } from "@hooks/index";

export interface OrderDayConfig {
  label: string;
  field: keyof OrderDays;
  defaultField: keyof OddDefaults;
}

/** The work days an order carries, in the order the Orders page shows them;
 * washing and cleaning only where the farm shows them. */
export function orderDayConfigs(
  t: TFunction,
  { showsWashing, showsCleaning }: WashingCleaningVisibility,
): OrderDayConfig[] {
  return [
    {
      label: t("commissioning.harvest_day_label"),
      field: "harvesting_day",
      defaultField: "default_harvesting_day",
    },
    ...(showsWashing
      ? [
          {
            label: t("commissioning.washing_day_label"),
            field: "washing_day" as const,
            defaultField: "default_washing_day" as const,
          },
        ]
      : []),
    ...(showsCleaning
      ? [
          {
            label: t("commissioning.cleaning_day_label"),
            field: "cleaning_day" as const,
            defaultField: "default_cleaning_day" as const,
          },
        ]
      : []),
    {
      label: t("commissioning.commissioning_day_label"),
      field: "packing_day",
      defaultField: "default_packing_day",
    },
  ];
}

/**
 * The days a new order still lacks. The backend refuses to start an order
 * with an empty day that the delivery day's order defaults can't fill, so
 * nothing is added while one is missing. An existing order keeps its own days.
 */
export function missingOrderDays(
  days: OrderDayConfig[],
  orderDays: OrderDays,
  orderId: string | number | null,
): OrderDayConfig[] {
  if (orderId != null) return [];
  return days.filter(({ field }) => orderDays[field] == null);
}
