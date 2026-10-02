import { Input, Typography } from "antd";
import { useTranslation } from "react-i18next";

import { PictureUploadField } from "@shared/ui";

import "./AppIconSettings.css";

const { Text } = Typography;

// Launchers cut labels off at about 12 characters; the column has the same cap.
const SHORT_NAME_MAX_LENGTH = 12;

interface AppIconSettingsProps {
  iconUrl?: string | null;
  iconUploading: boolean;
  onIconUpload: (file: File) => void;
  shortName: string;
  onShortNameChange: (value: string) => void;
  /** The tenant's full name; its first 12 characters are the label when no
   * short name is set. */
  tenantName: string;
}

/** The installable app's launcher icon and the label shown under it. */
export function AppIconSettings({
  iconUrl,
  iconUploading,
  onIconUpload,
  shortName,
  onShortNameChange,
  tenantName,
}: AppIconSettingsProps) {
  const { t } = useTranslation();

  return (
    <>
      <Text strong>{t("tenant.files.current_app_icon")}</Text>
      <div className="settings-hint app-icon-settings-hint">
        <Text type="secondary">{t("tenant.files.app_icon_hint")}</Text>
      </div>
      <PictureUploadField
        pictureUrl={iconUrl}
        uploading={iconUploading}
        onUpload={onIconUpload}
        previewVariant="inline"
        showDelete={false}
        requireSquare
        minSizePx={512}
      />

      <label htmlFor="app-short-name" className="app-short-name-label">
        <Text strong>{t("tenant.files.app_short_name")}</Text>
      </label>
      <Input
        id="app-short-name"
        value={shortName}
        maxLength={SHORT_NAME_MAX_LENGTH}
        showCount
        placeholder={tenantName.slice(0, SHORT_NAME_MAX_LENGTH)}
        onChange={(event) => onShortNameChange(event.target.value)}
      />
      <Text type="secondary" className="app-short-name-hint">
        {t("tenant.files.app_short_name_hint")}
      </Text>
    </>
  );
}
