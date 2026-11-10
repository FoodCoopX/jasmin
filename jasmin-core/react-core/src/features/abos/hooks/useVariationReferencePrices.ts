import { useCallback, useMemo } from "react";
import { useCommissioningShareTypeVariationPriceList } from "@shared/api/generated/commissioning/commissioning";
import type { ShareTypeVariationGrossPrice } from "@shared/api/generated/models";

export interface ReferencePrices {
  regular: string | null;
  trial: string | null;
}

/** A variation option with today's reference prices annotated. */
interface PricedVariation {
  value: string;
  active_price_per_delivery?: string | null;
  active_price_per_delivery_if_trial?: string | null;
}

/**
 * Each share type variation's reference prices by date, from its price
 * windows: what a subscription starting on a date is suggested to pay. The
 * backend checks the solidarity floor at the subscription's start too.
 */
export function useVariationReferencePrices() {
  const { data } = useCommissioningShareTypeVariationPriceList();

  const windowsByVariation = useMemo(() => {
    const windows = new Map<string, ShareTypeVariationGrossPrice[]>();
    for (const priceWindow of data ?? []) {
      const key = String(priceWindow.share_type_variation);
      windows.set(key, [...(windows.get(key) ?? []), priceWindow]);
    }
    return windows;
  }, [data]);

  /**
   * The prices to suggest for a subscription to `variation` starting on
   * `date` (YYYY-MM-DD): those of the window running then, else — without a
   * start or a window then — today's.
   */
  const referencePricesOn = useCallback(
    (variation: PricedVariation, date: string | null): ReferencePrices => {
      const priceWindow = date
        ? windowsByVariation
            .get(String(variation.value))
            ?.find(
              (each) =>
                each.valid_from <= date &&
                (!each.valid_until || each.valid_until >= date),
            )
        : undefined;
      return priceWindow
        ? {
            regular: priceWindow.price_per_delivery ?? null,
            trial: priceWindow.price_per_delivery_if_trial ?? null,
          }
        : {
            regular: variation.active_price_per_delivery ?? null,
            trial: variation.active_price_per_delivery_if_trial ?? null,
          };
    },
    [windowsByVariation],
  );

  /** Every reference price `variation` has, today or in any of its windows. */
  const allReferencePrices = useCallback(
    (variation: PricedVariation): (string | null | undefined)[] => [
      variation.active_price_per_delivery,
      variation.active_price_per_delivery_if_trial,
      ...(windowsByVariation.get(String(variation.value)) ?? []).flatMap(
        (priceWindow) => [
          priceWindow.price_per_delivery,
          priceWindow.price_per_delivery_if_trial,
        ],
      ),
    ],
    [windowsByVariation],
  );

  return { referencePricesOn, allReferencePrices };
}
