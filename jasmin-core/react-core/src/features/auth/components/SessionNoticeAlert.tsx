import { Alert } from "antd";
import { useTranslation } from "react-i18next";

import { useAuth } from "@shared/contexts/AuthContext";

/**
 * Tells a device that was signed in why it starts on the login form: its
 * session ran out, or the server couldn't be reached to restore it.
 */
export function SessionNoticeAlert() {
  const { t } = useTranslation();
  const { sessionNotice } = useAuth();

  if (sessionNotice === "expired") {
    return (
      <Alert
        type="info"
        showIcon
        message={t("auth.login_card.session_expired")}
      />
    );
  }
  if (sessionNotice === "unreachable") {
    return (
      <Alert
        type="warning"
        showIcon
        message={t("auth.login_card.server_unreachable")}
      />
    );
  }
  return null;
}
