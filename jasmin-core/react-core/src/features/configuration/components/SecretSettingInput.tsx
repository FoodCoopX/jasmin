import { Button, Input, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const { Text } = Typography;

interface SecretSettingInputProps {
  label: string;
  /** Whether the backend holds a value; it never sends the value back. */
  stored: boolean;
  saving?: boolean;
  /** A new value, or ``null`` to remove the stored one. */
  onSave: (value: string | null) => void;
}

/**
 * A credential the backend takes write-only. The field starts empty and says
 * only whether one is stored. What is typed goes out whole, on blur or Enter,
 * and the field empties again; a stored value can be removed.
 */
export function SecretSettingInput({
  label,
  stored,
  saving = false,
  onSave,
}: SecretSettingInputProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");

  const commit = () => {
    const value = draft.trim();
    if (!value) return;
    onSave(value);
    setDraft("");
  };

  let placeholder = t("settings.secret_missing");
  if (saving) placeholder = t("settings.secret_saving");
  else if (stored) placeholder = t("settings.secret_stored");

  return (
    <div>
      <Text strong>{label}</Text>
      <Input.Password
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onPressEnter={commit}
        placeholder={placeholder}
        aria-label={label}
        // Not the signed-in user's password: browsers ignore "off" on a
        // password field, and the password managers have their own opt-out.
        autoComplete="new-password"
        data-1p-ignore
        data-lpignore="true"
        className="mt-4"
      />
      {stored && !saving && (
        <Button type="link" size="small" onClick={() => onSave(null)}>
          {t("settings.secret_remove")}
        </Button>
      )}
    </div>
  );
}
