import { EditOutlined, EyeOutlined } from "@ant-design/icons";
import { Button, Modal } from "antd";
import DOMPurify from "dompurify";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import ModalCloseFooter from "@shared/modals/ModalCloseFooter";

/**
 * A station day's pickup info cell. The office opens the editor; the backend
 * refuses anyone else's save, so the other roles get the text read-only, and
 * nothing when the day has none.
 */
export default function StationDayPickupInfoCell({
  html,
  title,
  canEdit,
  onEdit,
  zIndex,
}: {
  html: string | null | undefined;
  title: string;
  canEdit: boolean;
  onEdit: () => void;
  zIndex?: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (canEdit) {
    return (
      <Button
        type="link"
        size="small"
        icon={<EditOutlined />}
        aria-label={t("table.edit")}
        onClick={onEdit}
      />
    );
  }
  if (!html) return null;

  return (
    <>
      <Button
        type="link"
        size="small"
        icon={<EyeOutlined />}
        aria-label={t("common.view")}
        onClick={() => setOpen(true)}
      />
      <Modal
        open={open}
        title={title}
        zIndex={zIndex}
        onCancel={() => setOpen(false)}
        footer={<ModalCloseFooter onClose={() => setOpen(false)} />}
      >
        <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
      </Modal>
    </>
  );
}
