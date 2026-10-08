import { useCallback } from "react";
import { useTranslation } from "react-i18next";

// Purposes some sends log instead of their template slug. Their ":" is
// i18next's namespace separator, so they can't be looked up as keys directly.
const OWN_PURPOSE_KEYS = new Map<string, string>([
  ["invoice:reseller", "email_matrix.purposes.invoice_reseller"],
  ["invoice:accounting", "email_matrix.purposes.invoice_accounting"],
  ["delivery_note:reseller", "email_matrix.purposes.delivery_note_reseller"],
  ["test:smtp", "email_matrix.purposes.test_smtp"],
]);

// A test send of a template logs ``test:<slug>``.
const TEST_SEND_PREFIX = "test:";

/** Names an email log purpose: a template slug, or one of the purposes the
 *  reseller invoices and delivery notes, the accounting copies and the test
 *  sends log. */
export function useEmailPurposeLabel(): (purpose: string) => string {
  const { t } = useTranslation();
  return useCallback(
    (purpose: string) => {
      const ownKey = OWN_PURPOSE_KEYS.get(purpose);
      if (ownKey) return t(ownKey);
      if (purpose.startsWith(TEST_SEND_PREFIX)) {
        const slug = purpose.slice(TEST_SEND_PREFIX.length);
        return t("email_matrix.purposes.test_send", {
          template: t(`email_matrix.${slug}`),
        });
      }
      return t(`email_matrix.${purpose}`);
    },
    [t],
  );
}
