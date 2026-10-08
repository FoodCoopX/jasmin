import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import {
  BankOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CreditCardOutlined,
  EyeOutlined,
  UserOutlined,
  MailOutlined,
  ExclamationCircleOutlined,
  HistoryOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { useHref, useLinkClickHandler } from "react-router-dom";

type ButtonType = "default" | "primary" | "dashed" | "text" | "link";
type ButtonSize = "small" | "middle" | "large";

interface ButtonConfig {
  type?: ButtonType;
  size?: ButtonSize;
  icon?: ReactNode;
  className?: string;
  /** i18n key for the tooltip + accessible name — resolved via ``t()`` in the
   *  button so a caller that omits a ``tooltip`` never surfaces raw English. */
  labelKey: string;
  style?: CSSProperties;
  danger?: boolean;
}

// Only variants actually referenced anywhere in the codebase are kept.
const BUTTON_CONFIGS: Record<string, ButtonConfig> = {
  view: {
    type: "text",
    size: "small",
    icon: <EyeOutlined className="lib-status-icon" />,
    labelKey: "button_library.view",
    className: "small-squared-button",
  },
  logging: {
    type: "text",
    icon: (
      <HistoryOutlined className="lib-status-icon lib-status-icon--future-blue" />
    ),
    className: "small-squared-button",
    labelKey: "button_library.logging",
  },
  emails: {
    type: "text",
    icon: (
      <MailOutlined className="lib-status-icon lib-status-icon--future-blue" />
    ),
    className: "small-squared-button",
    labelKey: "button_library.emails",
  },
  coopshares: {
    type: "text",
    icon: <BankOutlined className="lib-status-icon lib-status-icon--primary" />,
    className: "small-squared-button",
    labelKey: "button_library.coopshares",
  },
  bankDetails: {
    type: "text",
    icon: (
      <CreditCardOutlined className="lib-status-icon lib-status-icon--future-blue" />
    ),
    className: "small-squared-button",
    labelKey: "button_library.bank_details",
  },
  coopsharesAlert: {
    type: "text",
    icon: <BankOutlined className="lib-status-icon lib-status-icon--error" />,
    className: "small-squared-button",
    labelKey: "button_library.coopshares_alert",
  },
  cancel: {
    type: "text",
    icon: <StopOutlined className="lib-status-icon lib-status-icon--error" />,
    className: "small-squared-button",
    labelKey: "button_library.cancel",
  },
  ok: {
    type: "text",
    icon: (
      <CheckCircleOutlined className="lib-status-icon lib-status-icon--success" />
    ),
    className: "small-squared-button",
    labelKey: "button_library.ok",
  },
  not_ok: {
    type: "text",
    icon: (
      <ExclamationCircleOutlined className="lib-status-icon lib-status-icon--error" />
    ),
    className: "small-squared-button",
    labelKey: "button_library.not_ok",
  },
  adminConfirmed: {
    type: "text",
    icon: (
      <CheckCircleOutlined className="lib-status-icon lib-status-icon--base" />
    ),
    className: "small-squared-button",
    labelKey: "button_library.admin_confirmed",
    // The themed primary lightens in dark mode, so the label takes the base
    // colour like the icon does: light on dark green, dark on light green.
    style: {
      backgroundColor: "var(--color-primary)",
      color: "var(--color-bg-base)",
    },
  },
  adminPending: {
    type: "text",
    icon: (
      <ClockCircleOutlined className="lib-status-icon lib-status-icon--warning" />
    ),
    className: "small-squared-button",
    labelKey: "button_library.admin_pending",
  },
  adminRejected: {
    type: "text",
    icon: (
      <CloseCircleOutlined className="lib-status-icon lib-status-icon--on-solid" />
    ),
    className: "small-squared-button",
    labelKey: "button_library.admin_rejected",
    style: {
      backgroundColor: "var(--color-error)",
      color: "var(--color-text-on-solid)",
    },
  },
  userActive: {
    type: "text",
    icon: <UserOutlined className="lib-status-icon lib-status-icon--success" />,
    className: "small-squared-button",
    labelKey: "button_library.user_active",
  },
  userPendingApproval: {
    type: "text",
    icon: (
      <ClockCircleOutlined className="lib-status-icon lib-status-icon--warning" />
    ),
    className: "small-squared-button",
    labelKey: "button_library.user_pending_approval",
  },
  userPendingInvitation: {
    type: "text",
    icon: (
      <MailOutlined className="lib-status-icon lib-status-icon--future-blue" />
    ),
    className: "small-squared-button",
    labelKey: "button_library.user_pending_invitation",
  },
  userPendingInvitationExpired: {
    type: "text",
    icon: <MailOutlined className="lib-status-icon lib-status-icon--error" />,
    className: "small-squared-button",
    labelKey: "button_library.user_pending_invitation_expired",
  },
  userInactive: {
    type: "text",
    icon: (
      <UserOutlined className="lib-status-icon lib-status-icon--tertiary" />
    ),
    className: "small-squared-button",
    labelKey: "button_library.user_inactive",
  },
  userInvited: {
    type: "text",
    icon: <MailOutlined className="lib-status-icon lib-status-icon--warning" />,
    className: "small-squared-button",
    labelKey: "button_library.user_invited",
  },
  userNotInvited: {
    type: "text",
    icon: (
      <ExclamationCircleOutlined className="lib-status-icon lib-status-icon--warning" />
    ),
    className: "small-squared-button",
    labelKey: "button_library.user_not_invited",
  },
};

interface StatusButtonProps {
  variant: string;
  onClick?: () => void;
  tooltip?: string;
  disabled?: boolean;
  showTooltip?: boolean;
  [key: string]: unknown;
}

export const StatusButton = ({
  variant,
  onClick,
  tooltip,
  disabled = false,
  showTooltip = false,
  ...props
}: StatusButtonProps) => {
  const { t } = useTranslation();
  const config = BUTTON_CONFIGS[variant];
  if (!config) {
    console.warn(`Unknown status button variant: ${variant}`);
    return null;
  }

  // ``labelKey`` is not a Button prop — strip it before spreading. The default
  // label comes from the config's translated key; an explicit ``tooltip`` prop
  // (already localized by the caller) still wins.
  const { labelKey, ...buttonConfig } = config;
  const configLabel = t(labelKey);

  // These are icon-only buttons — give them an accessible name so screen
  // readers announce the action, not an empty button (the visible cue is the
  // hover tooltip, which SR/keyboard users don't get).
  const label = tooltip ?? configLabel;
  const button = (
    <Button
      {...buttonConfig}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      {...props}
    />
  );

  return showTooltip && (tooltip || configLabel) ? (
    <Tooltip
      title={tooltip || configLabel}
      classNames={{ root: "custom-tooltip" }}
    >
      {button}
    </Tooltip>
  ) : (
    button
  );
};

interface LinkButtonProps {
  variant?: string;
  to: string;
  tooltip?: string;
  disabled?: boolean;
  showTooltip?: boolean;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  [key: string]: unknown;
}

/** An icon-only link with the look of the library's buttons: AntD renders a
 *  Button with an ``href`` as a single ``<a>``, which the router's click
 *  handler turns into in-app navigation. Nesting a Button inside a router
 *  ``Link`` would put interactive content inside interactive content. */
export const LinkButton = ({
  variant = "view",
  to,
  tooltip,
  disabled = false,
  showTooltip = false,
  onClick,
  ...props
}: LinkButtonProps) => {
  const { t } = useTranslation();
  const href = useHref(to);
  const navigateOnClick = useLinkClickHandler<HTMLElement>(to);
  const config = BUTTON_CONFIGS[variant];
  if (!config) {
    console.warn(`Unknown link button variant: ${variant}`);
    return null;
  }

  const { labelKey, ...buttonConfig } = config;
  const configLabel = t(labelKey);

  // Icon-only → the link needs an accessible name (see StatusButton). An
  // empty tooltip still falls back to the variant's label.
  const label = tooltip || configLabel;
  const button = (
    <Button
      {...buttonConfig}
      href={href}
      disabled={disabled}
      aria-label={label}
      onClick={(event: MouseEvent<HTMLElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) navigateOnClick(event);
      }}
      {...props}
    />
  );

  return showTooltip && label ? (
    <Tooltip title={label} classNames={{ root: "custom-tooltip" }}>
      {button}
    </Tooltip>
  ) : (
    button
  );
};
