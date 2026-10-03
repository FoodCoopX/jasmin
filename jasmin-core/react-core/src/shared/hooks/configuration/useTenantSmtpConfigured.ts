import type { TenantEmailConfig } from "@shared/api/generated/models";
import { useTenantsEmailConfigList } from "@shared/api/generated/tenants/tenants";

/**
 * Whether the tenant has an SMTP host of its own. Without one the server sends
 * no tenant email and refuses the office actions whose only purpose is one (an
 * invitation, a waiting-list spot offer), so pages disable those actions and
 * say why. ``undefined`` until the email settings have loaded.
 */
export function useTenantSmtpConfigured(): boolean | undefined {
  const { data: emailConfig, isSuccess } = useTenantsEmailConfigList({
    query: {
      select: (data) => {
        // The endpoint returns a single object; orval types it as an array.
        const raw = data as unknown;
        return (Array.isArray(raw) ? raw[0] : raw) as TenantEmailConfig | undefined;
      },
    },
  });
  if (!isSuccess) return undefined;
  return Boolean(emailConfig?.smtp_host?.trim());
}
