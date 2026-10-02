import { Alert, Button } from "antd";
import { useTranslation } from "react-i18next";

import { useNewVersionAvailable } from "@shared/hooks/useNewVersionAvailable";

import "./NewVersionBanner.css";

/**
 * Offers a reload once the server serves a newer build than this tab runs. A
 * reload loads the new ``index.html`` and, with it, the new bundle.
 */
export default function NewVersionBanner() {
  const { t } = useTranslation();
  const newVersionAvailable = useNewVersionAvailable();

  if (!newVersionAvailable) return null;

  return (
    <Alert
      className="new-version-banner"
      type="info"
      banner
      showIcon
      message={t("common.new_version_banner")}
      action={
        <Button
          size="small"
          type="primary"
          onClick={() => window.location.reload()}
        >
          {t("common.reload")}
        </Button>
      }
    />
  );
}
