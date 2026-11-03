import { useContext } from "react";
import type { HostCapabilities } from "@shared/api/generated/models";
import { TenantContext } from "@shared/contexts/TenantContext";

/**
 * Whether this deployment offers ``name``. Jasmin embedded in another
 * application (``JASMIN_HOST`` on the backend) lacks some of its own features;
 * the tenant payload reports which, and the UI hides the rest.
 *
 * A payload without capabilities — before the tenant has loaded, or from a
 * backend that doesn't send them yet — offers everything, and so does a tree
 * without a ``TenantProvider``: hiding a feature needs the backend to say so.
 */
export function useCapability(name: keyof HostCapabilities): boolean {
  const tenantContext = useContext(TenantContext);
  return tenantContext?.tenant?.capabilities?.[name] ?? true;
}
