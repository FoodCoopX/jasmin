import { SendOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { useTimeFormat } from "@hooks/index";
import {
  getCommissioningInvoicesRetrieveQueryKey,
  getCommissioningOrdersOverviewListQueryKey,
  useCommissioningInvoicesRetrieve,
  useCommissioningInvoicesSendToAccountingCreate,
  useCommissioningInvoicesSendToResellerCreate,
} from "@shared/api/generated/commissioning/commissioning";
import type { InvoiceReseller } from "@shared/api/generated/models";
import { notify } from "@shared/utils";

type DocumentKind = "invoice" | "storno";

interface LineLabels {
  sentAt: string;
  send: string;
  sendAgain: string;
}

// Translation keys per document and recipient. The button texts name the
// recipient, so the two buttons of a document (and an invoice's next to its
// storno's) can be told apart by their accessible names.
const LABEL_KEYS: Record<
  DocumentKind,
  { reseller: LineLabels; accounting: LineLabels; sent: string; failed: string }
> = {
  invoice: {
    reseller: {
      sentAt: "commissioning.sent_to_resellers_at",
      send: "commissioning.invoice_send_to_reseller",
      sendAgain: "commissioning.invoice_send_to_reseller_again",
    },
    accounting: {
      sentAt: "commissioning.sent_to_accounting_at",
      send: "commissioning.invoice_send_to_accounting",
      sendAgain: "commissioning.invoice_send_to_accounting_again",
    },
    sent: "commissioning.invoice_sent",
    failed: "commissioning.invoice_send_failed",
  },
  storno: {
    reseller: {
      sentAt: "commissioning.storno_sent_to_reseller_at",
      send: "commissioning.storno_send_to_reseller",
      sendAgain: "commissioning.storno_send_to_reseller_again",
    },
    accounting: {
      sentAt: "commissioning.storno_sent_to_accounting_at",
      send: "commissioning.storno_send_to_accounting",
      sendAgain: "commissioning.storno_send_to_accounting_again",
    },
    sent: "commissioning.storno_sent",
    failed: "commissioning.storno_send_failed",
  },
};

interface SendLineProps {
  labels: LineLabels;
  sentAt: string | null | undefined;
  showSend: boolean;
  sending: boolean;
  onSend: () => void;
}

const SendLine: FC<SendLineProps> = ({
  labels,
  sentAt,
  showSend,
  sending,
  onSend,
}) => {
  const { t } = useTranslation();
  const { formatDateTime } = useTimeFormat();
  return (
    <p>
      <strong>{t(labels.sentAt)}</strong> {sentAt ? formatDateTime(sentAt) : ""}{" "}
      {showSend && (
        <Button
          size="small"
          icon={<SendOutlined />}
          loading={sending}
          onClick={onSend}
        >
          {t(sentAt ? labels.sendAgain : labels.send)}
        </Button>
      )}
    </p>
  );
};

interface DocumentSendStatusProps {
  kind: DocumentKind;
  invoiceId: string;
  invoice: InvoiceReseller;
  canSend: boolean;
}

const DocumentSendStatus: FC<DocumentSendStatusProps> = ({
  kind,
  invoiceId,
  invoice,
  canSend,
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const labels = LABEL_KEYS[kind];
  const showSend = canSend && Boolean(invoice.is_finalized && invoice.file);

  // Errors (a 400 naming why it can't be sent) surface through the global
  // mutation error toast.
  const handleResult = ({ sent }: { sent: boolean }) => {
    if (sent) {
      notify.success(t(labels.sent));
    } else {
      notify.warning(t(labels.failed));
    }
    void queryClient.invalidateQueries({
      queryKey: getCommissioningInvoicesRetrieveQueryKey(invoiceId),
    });
    // The Invoices page's sent columns, also when the modal has closed by now.
    void queryClient.invalidateQueries({
      queryKey: getCommissioningOrdersOverviewListQueryKey(),
    });
  };
  const sendToReseller = useCommissioningInvoicesSendToResellerCreate({
    mutation: { onSuccess: handleResult },
  });
  const sendToAccounting = useCommissioningInvoicesSendToAccountingCreate({
    mutation: { onSuccess: handleResult },
  });

  return (
    <>
      <SendLine
        labels={labels.reseller}
        sentAt={invoice.has_been_sent_to_reseller_at}
        showSend={showSend}
        sending={sendToReseller.isPending}
        onSend={() => sendToReseller.mutate({ id: invoiceId })}
      />
      <SendLine
        labels={labels.accounting}
        sentAt={invoice.has_been_sent_to_accounting_at}
        showSend={showSend}
        sending={sendToAccounting.isPending}
        onSend={() => sendToAccounting.mutate({ id: invoiceId })}
      />
    </>
  );
};

interface InvoiceSendStatusProps {
  invoiceId: string;
  invoice: InvoiceReseller;
  /** Office users may send; everyone else only sees when it went out. */
  canSend: boolean;
}

/**
 * When the invoice went out to the reseller and to accounting, and the same
 * for its storno once it is cancelled; a storno is sent like an invoice but
 * has no screen of its own. While the PDF upload sends a document, its
 * timestamp holds the send's claim; a successful send replaces it with the
 * send time and a failed one clears it, so a blank timestamp means the
 * document hasn't gone out. Office users get a button to send it, or send it
 * again, once it is finalized and its PDF uploaded; the backend refuses with
 * a reason when there is no address to send to.
 */
const InvoiceSendStatus: FC<InvoiceSendStatusProps> = ({
  invoiceId,
  invoice,
  canSend,
}) => {
  const { t } = useTranslation();
  const stornoId = invoice.cancelled_by_invoice ?? null;
  const { data: storno } = useCommissioningInvoicesRetrieve(stornoId ?? "", {
    query: { enabled: Boolean(stornoId) },
  });

  return (
    <>
      <DocumentSendStatus
        kind="invoice"
        invoiceId={invoiceId}
        invoice={invoice}
        canSend={canSend}
      />
      {stornoId && storno && (
        <>
          <p>
            <strong>{t("commissioning.storno_invoice_title")}</strong>{" "}
            {storno.invoice_number}
          </p>
          <DocumentSendStatus
            kind="storno"
            invoiceId={stornoId}
            invoice={storno}
            canSend={canSend}
          />
        </>
      )}
    </>
  );
};

export default InvoiceSendStatus;
