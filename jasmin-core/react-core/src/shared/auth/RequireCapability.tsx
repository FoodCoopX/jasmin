import { useContext, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { HostCapabilities } from "@shared/api/generated/models";
import { TenantContext } from "@shared/contexts/TenantContext";
import { useCapability } from "@hooks/configuration/useCapability";
import NotAuthorizedResult from "@shared/ui/NotAuthorizedResult";

interface RequireCapabilityProps {
  /** The capability the page needs (see ``useCapability``). */
  name: keyof HostCapabilities;
  /** Rendered where the deployment lacks it. Defaults to a "not available here" view. */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Whole-page guard for a page this deployment may not offer. The menu already
 * hides the way there; this stops a bookmarked link from rendering a page whose
 * API doesn't exist here.
 *
 *   <RequireCapability name="user_accounts">
 *     <ConfigurationUsers />
 *   </RequireCapability>
 *
 * It renders nothing until the tenant payload has arrived: ``useCapability``
 * offers everything before then, and a page mounted in that moment would
 * already call its API.
 */
export function RequireCapability({
  name,
  fallback,
  children,
}: RequireCapabilityProps) {
  const { t } = useTranslation();
  const tenantLoading = useContext(TenantContext)?.loading ?? false;
  const offered = useCapability(name);
  if (tenantLoading) return null;
  if (!offered) {
    return (
      <>
        {fallback ?? (
          <NotAuthorizedResult message={t("auth.not_authorized.unavailable_here")} />
        )}
      </>
    );
  }
  return <>{children}</>;
}
