import { Alert } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useCapability, useTenant } from "@hooks/index";

interface ImportSharesModeBannerProps {
  /** i18n key of what the page can't offer while the amounts are imported. */
  messageKey: string;
}

/**
 * Explains on a page what the import-shares mode changes there: the tenant
 * takes its weekly share demand from imported amounts
 * (``uploads_weekly_share_amount``) instead of subscriptions. Renders nothing
 * when the tenant runs the normal subscription-driven flow.
 */
export default function ImportSharesModeBanner({
  messageKey,
}: ImportSharesModeBannerProps) {
  const { t } = useTranslation();
  const { getSetting } = useTenant();
  const usesExternalDemand = getSetting(
    "uploads_weekly_share_amount",
    false,
  ) as boolean;
  // A host that imports the amounts itself has no import page to link to.
  const offersManualShareImport = useCapability("manual_share_import");

  if (!usesExternalDemand) return null;

  return (
    <Alert
      type="info"
      banner
      showIcon
      message={
        <>
          {t(messageKey)}{" "}
          {offersManualShareImport && (
            <Link to="/commissioning/import-shares">
              {t("common.import_shares_mode_banner_link")}
            </Link>
          )}
        </>
      }
    />
  );
}
