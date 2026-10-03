import { Alert, Modal, Spin, Typography } from "antd";
import { useTranslation } from "react-i18next";

import { useGdprAdminPendingDeletionsPreviewRetrieve } from "@shared/api/generated/gdpr/gdpr";
import type {
  AdminPendingDeletion,
  DeletionPreview,
} from "@shared/api/generated/models";

const { Paragraph, Text } = Typography;

// The preview names each record by its Django model label and each further
// deletion by a target; both are translated here. An unknown label shows as
// it is, an unknown target with the server's own description.
const MODEL_LABEL_KEYS: Record<string, string> = {
  "accounts.JasminUser": "gdpr.preview.model.user",
  "commissioning.Member": "gdpr.preview.model.member",
  "commissioning.Subscription": "gdpr.preview.model.subscription",
  "commissioning.CoopShare": "gdpr.preview.model.coop_share",
  "commissioning.MemberLoan": "gdpr.preview.model.member_loan",
  "commissioning.CoopShareTransfer": "gdpr.preview.model.coop_share_transfer",
  "payments.BillingProfile": "gdpr.preview.model.billing_profile",
  "commissioning.ConsentRecord": "gdpr.preview.model.consent_record",
  "commissioning.Reseller": "gdpr.preview.model.reseller",
  "commissioning.ContactEntity": "gdpr.preview.model.contact",
  "commissioning.UserInvitation": "gdpr.preview.model.invitation",
  "notifications.EmailLog": "gdpr.preview.model.email_log",
};
const SIDE_CHANNEL_KEYS: Record<string, string> = {
  auditlog: "gdpr.preview.side_channel.auditlog",
  axes: "gdpr.preview.side_channel.axes",
  sepa_export: "gdpr.preview.side_channel.sepa_export",
  reseller_documents: "gdpr.preview.side_channel.reseller_documents",
};

interface ApproveDeletionModalProps {
  /** The request to approve; ``null`` keeps the modal closed. */
  request: AdminPendingDeletion | null;
  approving: boolean;
  onApprove: (request: AdminPendingDeletion) => void;
  onCancel: () => void;
}

/**
 * Approving a deletion request erases at once and for good, so the modal
 * first shows the dry-run of what it erases: the records and fields
 * anonymized, what else is deleted, and any retention obligation that still
 * blocks it — in which case it can't be approved yet.
 */
export default function ApproveDeletionModal({
  request,
  approving,
  onApprove,
  onCancel,
}: ApproveDeletionModalProps) {
  const { t } = useTranslation();
  const {
    data: preview,
    isLoading,
    isError,
  } = useGdprAdminPendingDeletionsPreviewRetrieve(request?.id ?? "", {
    query: { enabled: Boolean(request) },
  });
  const blocked = !preview || !preview.can_anonymize_now;

  return (
    <Modal
      open={Boolean(request)}
      title={t("gdpr.preview.title")}
      onCancel={onCancel}
      onOk={() => request && onApprove(request)}
      okText={t("gdpr.preview.approve")}
      okButtonProps={{ danger: true, disabled: blocked }}
      confirmLoading={approving}
      destroyOnHidden
      width={640}
    >
      {isLoading && <Spin />}
      {isError && (
        <Alert type="error" showIcon message={t("gdpr.preview.load_error")} />
      )}
      {preview && request && (
        <DeletionPreviewDetails
          preview={preview}
          subjectLabel={request.subject_label}
        />
      )}
    </Modal>
  );
}

function DeletionPreviewDetails({
  preview,
  subjectLabel,
}: {
  preview: DeletionPreview;
  subjectLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      {preview.retention_blocks.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t("gdpr.preview.blocked")}
          description={
            <ul>
              {preview.retention_blocks.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          }
        />
      )}
      <Paragraph>
        {t("gdpr.preview.intro", { subject: subjectLabel })}
      </Paragraph>
      <ul>
        {preview.models.map((entry) => (
          <li key={entry.model}>
            <Text strong>
              {MODEL_LABEL_KEYS[entry.model]
                ? t(MODEL_LABEL_KEYS[entry.model])
                : entry.model}
            </Text>{" "}
            <Text type="secondary">
              ({t("gdpr.preview.rows", { rows: entry.row_count })}):{" "}
              {entry.scrubbed_fields.map((field) => field.field).join(", ")}
            </Text>
          </li>
        ))}
      </ul>
      <Paragraph>{t("gdpr.preview.also_cleared")}</Paragraph>
      <ul>
        {preview.side_channels.map((channel) => (
          <li key={channel.target}>
            {SIDE_CHANNEL_KEYS[channel.target]
              ? t(SIDE_CHANNEL_KEYS[channel.target])
              : channel.description}
          </li>
        ))}
      </ul>
    </>
  );
}
