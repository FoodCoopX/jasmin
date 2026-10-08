import { Flex, Tag } from "antd";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EMPTY_DISPLAY } from "@shared/tables/BasicEditableTable/MobileCardList";
import "./primitives.css";

/**
 * Shared building blocks for mobile-card variants used by EditableTable's
 * `renderMobileCard`. These exist to remove copy/paste between the various
 * `*MobileCard` components in this folder.
 *
 * Conventions match the existing CSS classes in
 * `src/shared/tables/BasicEditableTable/MobileCardList.css`
 * (`mobile-card-item`, `mobile-card-content`, `mobile-card-title`, etc.) and
 * the global typography helpers (`text-hint`, `text-meta`, `text-muted-xs`,
 * `flex-baseline`, `text-secondary`).
 */

/** Placeholder for a missing value, the same en-dash the table's own
 *  mobile cards show. */
export const MOBILE_CARD_PLACEHOLDER = EMPTY_DISPLAY;

interface MobileCardProps {
  onClick?: () => void;
  finalized?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function MobileCard({
  onClick,
  finalized,
  className,
  style,
  children,
}: MobileCardProps) {
  const classes = [
    "mobile-card-item",
    "commissioning-mobile-card",
    onClick ? "is-clickable" : "",
    finalized ? "mobile-card-finalized" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // role + tabIndex + onKeyDown are all set together when onClick is present
    // (and all absent otherwise), so this stays accessible whether clickable or not.
    <div
      className={classes}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      style={style}
    >
      {children}
    </div>
  );
}

interface MobileCardTitleProps {
  name: ReactNode;
  sizeLabel?: string;
  finalized?: boolean;
  /** Optional right-aligned content (e.g. amount, badge). */
  rightSlot?: ReactNode;
  /** Wrap the whole title row in a content wrapper. */
  wrap?: boolean;
}

export function MobileCardTitle({
  name,
  sizeLabel,
  finalized,
  rightSlot,
}: MobileCardTitleProps) {
  const { t } = useTranslation();
  return (
    <div
      className={
        rightSlot ? "mobile-card-title has-right-slot" : "mobile-card-title"
      }
    >
      <Flex align="center" gap={6} component="span">
        {/* The finalized state is otherwise colour-only — role=img +
            aria-label exposes it to screen readers without any visual change. */}
        {finalized && (
          <span
            className="mobile-card-finalized-dot"
            role="img"
            aria-label={t("commissioning.finalized")}
          />
        )}
        {name}
        {sizeLabel && <span className="text-hint">{sizeLabel}</span>}
      </Flex>
      {rightSlot && (
        <span className="mobile-card-title-right">{rightSlot}</span>
      )}
    </div>
  );
}

/** Flex container for the standard "expected / actual / total" metric row. */
export function MobileCardMetricsRow({
  children,
  gap = 24,
}: {
  children: ReactNode;
  gap?: number;
}) {
  return (
    <Flex gap={gap} wrap className="mobile-card-metrics-row">
      {children}
    </Flex>
  );
}

interface MobileCardMetricProps {
  label?: ReactNode;
  value: ReactNode;
  unit?: string;
  emphasis?: "primary" | "secondary";
  /** The value's colour: a design token, e.g. `var(--color-success-text)`. */
  color?: string;
  minWidth?: number;
}

export function MobileCardMetric({
  label,
  value,
  unit,
  emphasis = "primary",
  color,
  minWidth,
}: MobileCardMetricProps) {
  const metricClasses = ["mobile-card-metric", minWidth ? "has-min-width" : ""]
    .filter(Boolean)
    .join(" ");
  const valueClasses = [
    "mobile-card-metric-value",
    emphasis === "secondary" ? "is-secondary" : "",
    color ? "has-color" : "",
  ]
    .filter(Boolean)
    .join(" ");
  // The two per-call values travel as custom properties the CSS reads.
  const metricStyle = minWidth
    ? ({ "--mobile-card-metric-min-width": `${minWidth}px` } as CSSProperties)
    : undefined;
  const valueStyle = color
    ? ({ "--mobile-card-metric-color": color } as CSSProperties)
    : undefined;
  return (
    <div className={metricClasses} style={metricStyle}>
      {label && <div className="text-muted-xs">{label}</div>}
      <div className="flex-baseline">
        <span className={valueClasses} style={valueStyle}>
          {value}
        </span>
        {unit && <span className="text-secondary">{unit}</span>}
      </div>
    </div>
  );
}

export function MobileCardNote({ note }: { note?: string | null }) {
  if (!note) return null;
  return <div className="text-meta">{note}</div>;
}

export function MobileCardTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="mobile-card-tags">
      {tags.map((tag) => (
        <Tag key={tag} className="mobile-card-tag">
          {tag}
        </Tag>
      ))}
    </div>
  );
}

/** Wraps content with the standard `.mobile-card-content.flex-min` shell. */
export function MobileCardContent({ children }: { children: ReactNode }) {
  return <div className="mobile-card-content flex-min">{children}</div>;
}
