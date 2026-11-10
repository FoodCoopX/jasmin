import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShareTypeVariations } from "@features/commissioning/hooks";
import type { ShareTypeVariationOption } from "@features/commissioning/hooks/useShareTypeVariations";
import { useShareTypeVariationSizeOptions, useTenant } from "@hooks/index";
import { isPackedLoose } from "@features/commissioning/utils/stationContents";
import type { PackingModeEnum } from "@shared/api/generated/models";
import { variationLabel } from "@shared/utils";
import { todayApiDate } from "@shared/utils/apiDate";

/**
 * The packing mode's options, those greyed out that would change how a running
 * or upcoming share size is packed: "boxes" while one is packed loose, "bulk"
 * while one is boxed. "Mixed" stays open; there each size is packed as its own
 * flag says, which need not match how a pure mode packed it. The backend
 * refuses the same switches.
 */
export function usePackingModeOptions() {
  const { t } = useTranslation();
  const { getSetting } = useTenant();
  const mode = getSetting("packing_mode", "BOXES") as PackingModeEnum;
  const { getShareTypeVariationSizeLabel } = useShareTypeVariationSizeOptions();
  const variationFilters = useMemo(
    () => ({ active_at_date: todayApiDate(), include_future: true, physical: true }),
    [],
  );
  const { shareTypeVariations } = useShareTypeVariations(variationFilters);

  return useMemo(() => {
    const packedLoose = (variation: ShareTypeVariationOption) =>
      isPackedLoose(Boolean(variation.is_packed_bulk), mode);
    const lockedBy = (target: string, changing: ShareTypeVariationOption[]) =>
      target !== mode && changing.length > 0
        ? {
            disabled: true,
            disabledReason: t("settings.commissioning.packing_mode_locked", {
              sizes: changing
                .map((variation) =>
                  variationLabel(
                    variation.share_type_name,
                    getShareTypeVariationSizeLabel(variation.size),
                  ),
                )
                .join(", "),
            }),
          }
        : {};
    return [
      {
        value: "BOXES",
        label: t("settings.commissioning.packing_mode_boxes"),
        ...lockedBy("BOXES", shareTypeVariations.filter(packedLoose)),
      },
      {
        value: "BULK",
        label: t("settings.commissioning.packing_mode_bulk"),
        ...lockedBy(
          "BULK",
          shareTypeVariations.filter((variation) => !packedLoose(variation)),
        ),
      },
      { value: "MIXED", label: t("settings.commissioning.packing_mode_mixed") },
    ];
  }, [mode, shareTypeVariations, getShareTypeVariationSizeLabel, t]);
}
