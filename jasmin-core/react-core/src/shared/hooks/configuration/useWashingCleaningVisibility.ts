import { useMemo } from "react";

import { useTenant } from "./useTenant";

export interface WashingCleaningVisibility {
  showsWashing: boolean;
  showsCleaning: boolean;
}

/**
 * Whether the farm shows washing and cleaning, set in the layout section of
 * the commissioning settings. Off, their work days, lists and columns stay out
 * of the UI; the backend plans them either way. Both show until a tenant turns
 * them off.
 */
export function useWashingCleaningVisibility(): WashingCleaningVisibility {
  const { getSetting } = useTenant();
  const showsWashing = getSetting("show_washing", true) !== false;
  const showsCleaning = getSetting("show_cleaning", true) !== false;
  return useMemo(
    () => ({ showsWashing, showsCleaning }),
    [showsWashing, showsCleaning],
  );
}
