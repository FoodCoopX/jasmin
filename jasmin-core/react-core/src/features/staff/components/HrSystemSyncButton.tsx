import { SyncOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

interface HrSystemSyncButtonProps {
  syncing: boolean;
  onSync: () => void;
}

/** Starts a sync with the tenant's HR system. */
export default function HrSystemSyncButton({
  syncing,
  onSync,
}: HrSystemSyncButtonProps) {
  const { t } = useTranslation();
  return (
    <Button
      color="magenta"
      variant="solid"
      icon={<SyncOutlined />}
      loading={syncing}
      onClick={onSync}
    >
      {t("staff.sync_from_hr_system")}
    </Button>
  );
}
