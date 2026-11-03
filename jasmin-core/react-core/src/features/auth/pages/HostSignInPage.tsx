import { Button, Result } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

/** When this tab last reloaded the host page to renew the sign-in. */
const LAST_RELOAD_KEY = "host-sign-in-reloaded-at";
/** A reload this recent didn't bring a session back, so another won't either. */
const RELOAD_PAUSE_MS = 60_000;

function reloadedRecently(): boolean {
  try {
    const reloadedAt = Number(sessionStorage.getItem(LAST_RELOAD_KEY));
    return Date.now() - reloadedAt < RELOAD_PAUSE_MS;
  } catch {
    return true;
  }
}

/** Notes the reload, or reports that it can't; without the note nothing would
 * stop the next sign-in page from reloading again, endlessly. */
function noteReload(): boolean {
  try {
    sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/** Reloads the page jasmin is embedded in, which renews the host's session or
 * shows the host's own sign-in. The two share an origin; should they not, the
 * page just stays put. */
function reloadHostPage() {
  try {
    (window.top ?? window).location.reload();
  } catch {
    /* no-op */
  }
}

/**
 * The sign-in page where jasmin has no logins of its own: the host application
 * signs people in. A session that ends here — the host's sign-in expired, or
 * jasmin's token couldn't be renewed — reloads the host page once; if that
 * happened a moment ago, the page offers the reload instead of looping.
 */
export default function HostSignInPage() {
  const { t } = useTranslation();

  useEffect(() => {
    if (!reloadedRecently() && noteReload()) reloadHostPage();
  }, []);

  return (
    <Result
      status="info"
      title={t("auth.host_sign_in.title")}
      subTitle={t("auth.host_sign_in.message")}
      extra={
        <Button type="primary" onClick={reloadHostPage}>
          {t("auth.host_sign_in.reload")}
        </Button>
      }
    />
  );
}
