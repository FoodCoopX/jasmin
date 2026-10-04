import { Alert } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const DISMISSED_KEY = "jasmin.home_screen_sign_in_notice_dismissed";

/** Whether this page runs as an app added to an iPhone's or iPad's home screen
 * (only iOS Safari sets ``navigator.standalone``). */
function isIosHomeScreenApp(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * On an iPhone or iPad, an app added to the home screen keeps its own sign-in,
 * apart from Safari's, so it asks for a sign-in even while Safari is signed in.
 * The home-screen app's login page says so until the viewer closes the note.
 */
export function HomeScreenSignInNotice() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(wasDismissed);

  if (dismissed || !isIosHomeScreenApp()) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Without storage the note only stays closed until the next load.
    }
    setDismissed(true);
  };

  return (
    <Alert
      type="info"
      showIcon
      closable
      onClose={dismiss}
      message={t("auth.login_card.home_screen_sign_in")}
    />
  );
}
