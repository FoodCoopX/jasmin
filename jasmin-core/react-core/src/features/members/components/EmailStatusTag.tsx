import { Tag, Tooltip } from "antd";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { getEmailStatusColor } from "@shared/utils/emailStatusColors";

interface EmailStatusTagProps {
  /** An ``EmailLog`` status, e.g. ``sent`` or ``suppressed``. */
  status: string;
}

// Held back on purpose — in onboarding mode, or past the tenant's hourly limit.
const HINTED_STATUSES = new Set(["suppressed", "rate_limited"]);

/**
 * An email log status as a colored tag with a short label. An email held back
 * on purpose — suppressed in onboarding mode, or past the tenant's hourly limit
 * — also says why it was not sent: in a light tooltip on hover, and as the
 * tag's accessible description.
 */
export default function EmailStatusTag({ status }: EmailStatusTagProps) {
  const { t } = useTranslation();
  const hintId = useId();
  const label = t(`email_matrix.status.${status}`);

  if (!HINTED_STATUSES.has(status)) {
    return (
      <Tag color={getEmailStatusColor(status)} className="email-status-tag">
        {label}
      </Tag>
    );
  }

  const hint = t(`email_matrix.status_hint.${status}`);
  return (
    <Tooltip
      title={hint}
      trigger="hover"
      classNames={{ root: "custom-tooltip" }}
    >
      {/* The tooltip sets its own aria-describedby on its direct child, so the
          tag inside keeps the hint as its description. */}
      <span>
        <Tag
          color={getEmailStatusColor(status)}
          className="email-status-tag"
          aria-describedby={hintId}
        >
          {label}
        </Tag>
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      </span>
    </Tooltip>
  );
}
