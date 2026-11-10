import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useTenant } from "@hooks/index";
import NotAuthorizedResult from "@shared/ui/NotAuthorizedResult";

/**
 * Whole-page guard for a page that exists only because the farm keeps its own
 * members and subscriptions. A farm that imports its weekly share amounts
 * keeps neither; the menus already hide these pages there, and this stops a
 * bookmarked link from rendering one.
 *
 * It renders nothing until the tenant's settings have arrived, which come with
 * the full tenant payload after the anonymous one: the mode reads as off
 * before then, and a page mounted in that moment would already call its API.
 */
export function RequireMembersAndSubscriptions({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { tenant, getSetting } = useTenant();
  if (!tenant?.settings) return null;
  if (getSetting("uploads_weekly_share_amount", false)) {
    return (
      <NotAuthorizedResult
        message={t("auth.not_authorized.unavailable_with_imported_shares")}
      />
    );
  }
  return <>{children}</>;
}
