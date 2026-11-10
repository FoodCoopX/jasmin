import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useWashingCleaningVisibility } from "@hooks/index";
import { orderDayConfigs } from "../utils/orderDays";

/** The work days the Orders page asks for, washing and cleaning only where
 * the farm shows them. */
export function useOrderDayConfigs() {
  const { t } = useTranslation();
  const shownWorkDays = useWashingCleaningVisibility();
  return useMemo(() => orderDayConfigs(t, shownWorkDays), [t, shownWorkDays]);
}
