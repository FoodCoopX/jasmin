import { useTranslation } from "react-i18next";

import EmptyHint from "./EmptyHint";

/** The whole content of a page that is planned but not built yet. */
export default function ComingSoon() {
  const { t } = useTranslation();
  return <EmptyHint>{t("common.coming_soon")}</EmptyHint>;
}
