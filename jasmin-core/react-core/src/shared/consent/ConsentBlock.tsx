import { useEffect, useRef } from "react";
import { PrinterOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Checkbox, Skeleton, Space, Typography } from "antd";
import dayjs from "dayjs";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";
import {
  commissioningConsentDocumentsCurrentRetrieve,
  getCommissioningConsentDocumentsCurrentRetrieveQueryKey,
} from "@shared/api/generated/commissioning/commissioning";
import { CommissioningConsentDocumentsCurrentRetrieveKind } from "@shared/api/generated/models/commissioningConsentDocumentsCurrentRetrieveKind";
import { useDateFormat, useTenant } from "@hooks/index";
import { getErrorCode } from "@shared/utils/apiError";

type ConsentKind = CommissioningConsentDocumentsCurrentRetrieveKind;

const { Text } = Typography;

interface ConsentBlockProps {
  /** ConsentKind to fetch — privacy, sepa, withdrawal, or terms. */
  kind: ConsentKind;
  /** Locale code (e.g. ``"de"``, ``"en"``). Defaults to ``"de"``. */
  locale?: string;
  /** Whether the user has ticked the checkbox. Controlled by the parent. */
  checked: boolean;
  /**
   * Notify the parent: ``(checked, documentId)``. ``documentId`` is the
   * document actually shown, and is undefined while it is still loading. The
   * parent hands it to whatever records the consent — best the domain
   * endpoint that writes the ConsentRecord in the same transaction as its own
   * change, as ``my_sepa_mandate`` does with ``consent_document_id``.
   */
  onChange: (checked: boolean, documentId: string | undefined) => void;
}

/**
 * Renders the current ConsentDocument for ``(kind, locale)``, with a
 * scrollable body and an "I agree" checkbox.
 *
 * Controlled component — it records nothing itself, it only reports what was
 * accepted (see ``onChange``).
 *
 * The office publishes documents in the tenant's language, so a reader whose
 * locale has none is shown the tenant-language document instead. If neither
 * exists, renders a blocking error so the form can't silently send a
 * "consent to nothing" record.
 */
export default function ConsentBlock({
  kind,
  locale = "de",
  checked,
  onChange,
}: ConsentBlockProps) {
  const { t, i18n } = useTranslation();
  const { getSetting, tenant, tenantName } = useTenant();
  const { dateFormat } = useDateFormat();
  const effectiveLocale = locale || i18n.language || "de";

  // When the tenant requires a wet-ink signature for this document kind, the
  // member must print, sign and mail it — show the hint + a print button that
  // opens a clean print view with the office address and a signature line.
  const paperSettingByKind: Partial<Record<ConsentKind, string>> = {
    sepa: "requires_paper_signature_for_sepa_mandate",
    coop_contract: "requires_paper_signature_for_membership",
  };
  const paperSettingKey = paperSettingByKind[kind];
  const requiresPaperSignature = paperSettingKey
    ? Boolean(getSetting(paperSettingKey, false))
    : false;
  const officeAddressLines = [
    tenantName,
    tenant?.address,
    [tenant?.zip_code, tenant?.city].filter(Boolean).join(" ").trim(),
  ].filter((line): line is string => Boolean(line && line.trim()));

  // One query for both lookups, so a document once found stays shown through
  // background refetches. Only "no document in this locale" falls back, never
  // another failure. Silent: the block renders its own error alert.
  const fallbackLocale = tenant?.tenant_language;
  const {
    data: document,
    isLoading,
    error,
  } = useQuery({
    queryKey: [
      ...getCommissioningConsentDocumentsCurrentRetrieveQueryKey({
        kind,
        locale: effectiveLocale,
      }),
      { fallbackLocale },
    ],
    queryFn: async ({ signal }) => {
      try {
        return await commissioningConsentDocumentsCurrentRetrieve(
          { kind, locale: effectiveLocale },
          signal,
        );
      } catch (err) {
        if (
          !fallbackLocale ||
          fallbackLocale === effectiveLocale ||
          getErrorCode(err) !== "consent.document_not_found"
        ) {
          throw err;
        }
        return commissioningConsentDocumentsCurrentRetrieve(
          { kind, locale: fallbackLocale },
          signal,
        );
      }
    },
    retry: false,
    meta: { silent: true },
  });

  // Read ``checked``/``onChange`` through refs so the document-load
  // effect below emits the CURRENT values, not whatever it closed over
  // when the document id first resolved. The effect fires only on
  // document-id change by design (the Checkbox handler covers interactive
  // toggles); callers may pass a non-memoized ``onChange``.
  const checkedRef = useRef(checked);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    checkedRef.current = checked;
    onChangeRef.current = onChange;
  });

  // Bubble up the document_id once it lands so the parent has it
  // ready by the time the form submits, even if the user already
  // ticked the box before the network call returned.
  useEffect(() => {
    if (document?.id) {
      onChangeRef.current(checkedRef.current, document.id);
    }
  }, [document?.id]);

  const handlePrint = () => {
    if (!document) return;
    const printWindow = window.open("", "_blank", "width=820,height=900");
    if (!printWindow) return;
    const escape = (value: string) =>
      value.replace(
        /[&<>"]/g,
        (char) =>
          ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ??
          char,
      );
    // Body is office-authored HTML (Quill) — sanitise before injecting.
    const bodyHtml = DOMPurify.sanitize(document.body);
    const addressHtml = officeAddressLines
      .map((line) => `<div>${escape(line)}</div>`)
      .join("");
    printWindow.document.write(
      `<!doctype html><html lang="${escape(document.locale || effectiveLocale)}"><head>` +
        `<meta charset="utf-8" /><title>${escape(document.title || "")}</title>` +
        `<style>` +
        `body{font-family:system-ui,-apple-system,sans-serif;color:#1a1a1a;margin:40px;line-height:1.5}` +
        `h1{font-size:18px;margin:0 0 4px}` +
        `.meta{color:#666;font-size:12px;margin-bottom:24px}` +
        `.doc{font-size:13px}` +
        `.hint{margin-top:32px;padding:16px;border:1px solid #999;border-radius:6px;font-size:13px}` +
        `.hint .address{margin-top:8px;font-weight:600}` +
        `.signature .line{margin-top:56px;border-top:1px solid #1a1a1a;width:320px;padding-top:4px;font-size:12px;color:#666}` +
        `@media print{body{margin:24px}}` +
        `</style></head><body>` +
        `<h1>${escape(document.title || "")}</h1>` +
        `<div class="meta">${escape(t("consent.block.version_label"))} ${escape(document.version)}</div>` +
        `<div class="doc">${bodyHtml}</div>` +
        `<div class="hint">${escape(t("consent.print.paper_required_hint"))}<div class="address">${addressHtml}</div></div>` +
        `<div class="signature"><div class="line">${escape(t("consent.print.signature_line"))}</div></div>` +
        `</body></html>`,
    );
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  if (isLoading) {
    return (
      <Card size="small">
        <Skeleton active paragraph={{ rows: 4 }} />
      </Card>
    );
  }

  if (error || !document) {
    return (
      <Alert
        type="error"
        showIcon
        message={t("consent.block.missing_document_title")}
        description={t(
          "consent.block.missing_document_body",
          { kind, locale: effectiveLocale },
        )}
      />
    );
  }

  // Shown in the tenant's language when the reader's has none, so the text can
  // differ from the page language that assistive tech would otherwise apply.
  const documentLanguage = document.locale || effectiveLocale;

  return (
    <Card
      size="small"
      title={
        document.title ? (
          <span lang={documentLanguage}>{document.title}</span>
        ) : (
          t(`consent.kind.${kind}`, kind)
        )
      }
    >
      <div
        lang={documentLanguage}
        className="consent-document-box"
        style={{ maxHeight: 200, marginBottom: 12, fontSize: 12 }}
        // Body is office-authored HTML (Quill); sanitise before rendering.
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(document.body) }}
      />
      <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 8 }}>
        {t("consent.block.version_label")} {document.version}
        {document.valid_from
          ? ` · ${t("consent.block.effective_label")} ${dayjs(document.valid_from).format(dateFormat)}`
          : ""}
      </Text>
      {requiresPaperSignature && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={t("consent.print.paper_required_hint")}
          description={
            <Space direction="vertical" size={6} className="w-full">
              {officeAddressLines.length > 0 && (
                <div>
                  {officeAddressLines.map((line) => (
                    <div key={line} style={{ fontWeight: 600 }}>
                      {line}
                    </div>
                  ))}
                </div>
              )}
              <Button
                size="small"
                icon={<PrinterOutlined />}
                onClick={handlePrint}
              >
                {t("consent.print.action")}
              </Button>
            </Space>
          }
        />
      )}
      <Checkbox
        checked={checked}
        onChange={(e) => onChange(e.target.checked, document.id)}
      >
        {t(`consent.block.agree.${kind}`, {
          defaultValue: t("consent.block.agree.default"),
        })}
      </Checkbox>
    </Card>
  );
}

// Re-export the kind enum for parents to reference without crossing
// the generated-models boundary themselves.
export {
  CommissioningConsentDocumentsCurrentRetrieveKind as ConsentDocumentKind,
};
export type { ConsentKind };
