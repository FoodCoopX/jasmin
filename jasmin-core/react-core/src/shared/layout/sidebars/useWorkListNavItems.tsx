import { useWashingCleaningVisibility } from "@hooks/index";
import type { RoleGatedItem } from "@shared/auth";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

/**
 * The commissioning sidebar's washing and cleaning lists, each only where the
 * farm shows washing or cleaning.
 */
export function useWorkListNavItems(): RoleGatedItem[] {
  const { t } = useTranslation();
  const { showsWashing, showsCleaning } = useWashingCleaningVisibility();

  return [
    ...(showsWashing
      ? [
          {
            key: "commissioning-washing-list",
            requireRole: "isStaff" as const,
            label: (
              <Link to="/commissioning/washing-list">
                {t("commissioning.washing_list")}
              </Link>
            ),
          },
        ]
      : []),
    ...(showsCleaning
      ? [
          {
            key: "commissioning-cleaning-list",
            requireRole: "isStaff" as const,
            label: (
              <Link to="/commissioning/cleaning-list">
                {t("commissioning.cleaning_list")}
              </Link>
            ),
          },
        ]
      : []),
  ];
}
