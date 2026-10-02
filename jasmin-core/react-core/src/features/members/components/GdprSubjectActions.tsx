import { DeleteOutlined, DownloadOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, Divider, Space, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { getCommissioningMembersRetrieveQueryKey } from "@shared/api/generated/commissioning/commissioning";
import {
  gdprAdminMembersSubjectAccessRetrieve,
  gdprAdminResellersSubjectAccessRetrieve,
} from "@shared/api/generated/gdpr/gdpr";
import { useRoles } from "@shared/auth";
import { downloadBlob, notify } from "@shared/utils";
import { getErrorMessage } from "@shared/utils/apiError";

import EraseSubjectModal from "../modals/EraseSubjectModal";

const { Paragraph, Text } = Typography;

/** Whom the office's data-protection actions are about. */
export interface GdprSubject {
  kind: "member" | "reseller";
  id: string;
}

interface GdprSubjectActionsProps {
  subject: GdprSubject;
  /** Called after the subject's personal data has been erased. */
  onErased?: () => void;
}

/**
 * The office answers a data-protection request the person made by email,
 * letter, phone or in person — also for someone without a login: export
 * their personal data (Art. 15) or erase it (Art. 17). Admins only; both
 * ask for the password again (step-up).
 */
export default function GdprSubjectActions({
  subject,
  onErased,
}: GdprSubjectActionsProps) {
  const { t } = useTranslation();
  const { isAdmin } = useRoles();
  const [exporting, setExporting] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);

  if (!isAdmin) return null;

  const handleExport = async () => {
    setExporting(true);
    try {
      const bundle =
        subject.kind === "member"
          ? await gdprAdminMembersSubjectAccessRetrieve(subject.id)
          : await gdprAdminResellersSubjectAccessRetrieve(subject.id);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      downloadBlob(blob, `personal-data-${subject.kind}-${subject.id}.json`);
    } catch (error) {
      notify.error(getErrorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Space wrap>
        <Button
          icon={<DownloadOutlined />}
          loading={exporting}
          onClick={handleExport}
        >
          {t("gdpr.office_actions.export")}
        </Button>
        <Button
          danger
          icon={<DeleteOutlined />}
          onClick={() => setEraseOpen(true)}
        >
          {t("gdpr.office_actions.erase")}
        </Button>
      </Space>
      <EraseSubjectModal
        open={eraseOpen}
        subject={subject}
        onClose={() => setEraseOpen(false)}
        onErased={onErased}
      />
    </>
  );
}

/** The office's data-protection actions on a member's page. */
export function MemberDataProtectionCard({ memberId }: { memberId: string }) {
  const { t } = useTranslation();
  const { isAdmin } = useRoles();
  const queryClient = useQueryClient();
  if (!isAdmin) return null;

  return (
    <Card
      title={t("gdpr.office_actions.title")}
      className="member-card--blue-title member-card--top-spaced"
    >
      <Paragraph type="secondary">
        {t("gdpr.office_actions.description")}
      </Paragraph>
      <GdprSubjectActions
        subject={{ kind: "member", id: memberId }}
        onErased={() =>
          queryClient.invalidateQueries({
            queryKey: getCommissioningMembersRetrieveQueryKey(memberId),
          })
        }
      />
    </Card>
  );
}

/** The office's data-protection actions in a reseller's account dialog. */
export function ResellerDataProtection({
  reseller,
}: {
  reseller: { id?: unknown } | null;
}) {
  const { t } = useTranslation();
  const { isAdmin } = useRoles();
  if (!isAdmin || !reseller?.id) return null;

  return (
    <>
      <Divider />
      <Text strong>{t("gdpr.office_actions.title")}</Text>
      <Paragraph type="secondary">
        {t("gdpr.office_actions.description")}
      </Paragraph>
      <GdprSubjectActions
        subject={{ kind: "reseller", id: String(reseller.id) }}
      />
    </>
  );
}
