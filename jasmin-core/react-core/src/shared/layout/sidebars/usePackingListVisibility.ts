import { useTenant } from "@hooks/index";
import { useCommissioningShareTypeVariationsList } from "@shared/api/generated/commissioning/commissioning";
import { todayApiDate } from "@shared/utils/apiDate";

/**
 * Which packing lists the tenant's ``packing_mode`` offers. The boxes list and
 * the commissioning list for packing belong to box packing, the bulk list to
 * bulk packing; ``MIXED`` offers both, the bulk list only while a current or
 * upcoming physical variation is packed in bulk, since in that mode it lists
 * those alone. Every navigation that links them reads this one rule, so the
 * desktop sidebar and the phone drawer can't disagree.
 *
 * The weight statistics follow the boxes, as only boxes are weighed: box
 * packing, or ``MIXED`` while a current or upcoming physical variation is
 * packed in boxes.
 */
export function usePackingListVisibility() {
  const { getSetting } = useTenant();
  const packingMode = getSetting("packing_mode", "BOXES");
  const { data: physicalVariations } = useCommissioningShareTypeVariationsList(
    {
      active_at_date: todayApiDate(),
      include_future: true,
      physical: true,
    },
    { query: { enabled: packingMode === "MIXED" } },
  );
  const packsSomeVariationInBulk = (physicalVariations ?? []).some(
    (variation) => variation.is_packed_bulk,
  );
  const packsSomeVariationInBoxes = (physicalVariations ?? []).some(
    (variation) => !variation.is_packed_bulk,
  );
  return {
    packingMode,
    showBulkPackingList:
      packingMode === "BULK" ||
      (packingMode === "MIXED" && packsSomeVariationInBulk),
    showBoxesPackingList: packingMode === "BOXES" || packingMode === "MIXED",
    showWeightStatistics:
      packingMode === "BOXES" ||
      (packingMode === "MIXED" && packsSomeVariationInBoxes),
  };
}
