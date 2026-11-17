import { useTenant } from "@hooks/index";
import { type RoleGatedItem } from "@shared/auth";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface PurchaseNavItems {
  /** Under the amounts, with the other documentation. */
  documentationItems: RoleGatedItem[];
  /** Under the planning: the order list and the statistics. */
  planningItems: RoleGatedItem[];
  /** Under the data: the suppliers. */
  dataItems: RoleGatedItem[];
}

/**
 * The commissioning sidebar's entries for produce bought in. A farm that buys
 * nothing in gets none of them.
 */
export function usePurchaseNavItems(): PurchaseNavItems {
  const { t } = useTranslation();
  const { getSetting } = useTenant();

  if (!getSetting("has_purchases", true)) {
    return { documentationItems: [], planningItems: [], dataItems: [] };
  }

  const link = (
    path: string,
    label: string,
    requireRole: RoleGatedItem["requireRole"],
  ): RoleGatedItem => ({
    key: `commissioning-${path}`,
    requireRole,
    label: <Link to={`/commissioning/${path}`}>{label}</Link>,
  });

  return {
    documentationItems: [
      link(
        "documentation-purchase",
        t("commissioning.documentation_purchase"),
        "isStaff",
      ),
    ],
    planningItems: [
      link("purchase-list", t("commissioning.purchase_list"), "isOffice"),
      link(
        "statistics-purchase",
        t("commissioning.statistics_purchase"),
        "isOffice",
      ),
    ],
    dataItems: [link("list-sellers", t("commissioning.list_sellers"), "isOffice")],
  };
}
