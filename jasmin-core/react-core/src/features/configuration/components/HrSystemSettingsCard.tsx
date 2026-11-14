import { Card, Checkbox, Input, Space, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PatchedTenantRequest } from "@shared/api/generated/models";
import { useTenantsTenantsPartialUpdate } from "@shared/api/generated/tenants/tenants";
import { useTenant } from "@hooks/index";
import { SecretSettingInput } from "./SecretSettingInput";

const { Text } = Typography;

const ADDRESS_FIELDS = [
  "hr_system_employees_url",
  "hr_system_absences_url",
] as const;

/**
 * The tenant's external time-tracking system: whether the staff list comes
 * from it, the addresses Jasmin reads, and the token it reads them with. Each
 * field saves on its own once it is left, so no half-typed address is checked;
 * the page's autosave leaves these fields out, so it never sends an older copy
 * back.
 */
export default function HrSystemSettingsCard() {
  const { t } = useTranslation();
  const { tenant, refreshTenant } = useTenant();
  const { mutate: patchTenant, isPending } = useTenantsTenantsPartialUpdate({
    mutation: {
      onSuccess: () => {
        void refreshTenant();
      },
    },
  });

  const save = useCallback(
    (data: PatchedTenantRequest) => {
      if (tenant?.id) patchTenant({ id: String(tenant.id), data });
    },
    [patchTenant, tenant?.id],
  );

  const enabled = Boolean(tenant?.uses_hr_system);

  return (
    <Card
      title={t("settings.hr_system.title")}
      className="settings-card-header page-narrow"
      styles={{ body: { padding: "16px" } }}
    >
      <Checkbox
        checked={enabled}
        onChange={(event) => save({ uses_hr_system: event.target.checked })}
      >
        {t("settings.hr_system.uses_hr_system")}
      </Checkbox>
      <div>
        <Text type="secondary" className="text-12">
          {t("settings.hr_system.uses_hr_system_desc")}
        </Text>
      </div>
      {enabled && (
        <Space direction="vertical" size="middle" className="w-full mt-16">
          {ADDRESS_FIELDS.map((field) => (
            <AddressInput
              key={field}
              label={t(`settings.hr_system.${field}`)}
              placeholder={t(`settings.hr_system.${field}_placeholder`)}
              stored={tenant?.[field] ?? ""}
              onSave={(value) => save({ [field]: value })}
            />
          ))}
          <SecretSettingInput
            label={t("settings.hr_system.api_token")}
            stored={Boolean(tenant?.has_hr_system_api_token)}
            saving={isPending}
            onSave={(value) => save({ hr_system_api_token: value })}
          />
          <Text type="secondary" className="text-12">
            {t("settings.hr_system.format")}
          </Text>
        </Space>
      )}
    </Card>
  );
}

interface AddressInputProps {
  label: string;
  placeholder: string;
  stored: string;
  onSave: (value: string) => void;
}

/** An address that is saved once it is left, and only when it changed. */
function AddressInput({ label, placeholder, stored, onSave }: AddressInputProps) {
  const [draft, setDraft] = useState(stored);
  useEffect(() => setDraft(stored), [stored]);

  const commit = () => {
    const value = draft.trim();
    if (value !== stored) onSave(value);
  };

  return (
    <div>
      <Text strong>{label}</Text>
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onPressEnter={commit}
        placeholder={placeholder}
        aria-label={label}
        inputMode="url"
        className="mt-4"
      />
    </div>
  );
}
