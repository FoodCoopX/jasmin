import { useTranslation } from "react-i18next";

import { useTenantSmtpConfigured } from "./useTenantSmtpConfigured";

/**
 * Why an invitation can't be sent right now, or ``null``: the caller's own
 * reason first (onboarding mode for a member's portal login), then a missing
 * SMTP host of the tenant's own, without which the server refuses every
 * invitation.
 */
export function useInvitationDisabledReason(
  callerReason: string | null | undefined,
): string | null {
  const { t } = useTranslation();
  const smtpConfigured = useTenantSmtpConfigured();
  if (callerReason) return callerReason;
  return smtpConfigured === false ? t("users.smtp_missing_reason") : null;
}
