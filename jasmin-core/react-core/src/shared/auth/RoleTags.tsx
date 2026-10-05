import { Tag } from "antd";
import { useMemo } from "react";
import { ROLES } from "./roles";
import { useRoleOptions } from "./useRoleOptions";

interface RoleTagColors {
  bg: string;
  border: string;
  text: string;
}

// The ``--color-role-<role>-*`` tokens: a tinted chip per role, with a dark
// variant each.
const roleTagColors = (role: string): RoleTagColors => ({
  bg: `var(--color-role-${role}-bg)`,
  border: `var(--color-role-${role}-border)`,
  text: `var(--color-role-${role}-text)`,
});

// Single source of truth — do not re-declare per page.
const ROLE_TAG_COLORS: Record<string, RoleTagColors> = {
  [ROLES.ADMIN]: roleTagColors("admin"),
  [ROLES.MANAGEMENT]: roleTagColors("management"),
  [ROLES.OFFICE]: roleTagColors("office"),
  [ROLES.STAFF]: roleTagColors("staff"),
  [ROLES.GARDENER]: roleTagColors("gardener"),
  [ROLES.MEMBER]: roleTagColors("member"),
  [ROLES.CUSTOMER]: roleTagColors("customer"),
};
const DEFAULT_ROLE_COLOR: RoleTagColors = {
  bg: "var(--color-bg-hover)",
  border: "var(--color-border)",
  text: "var(--color-text-secondary)",
};

interface RoleTagsProps {
  /** The user's role slugs (e.g. ``["office", "admin"]``). */
  roles: readonly string[] | null | undefined;
  /** Rendered (muted) when the user has no roles. Omit to render nothing. */
  emptyText?: string;
}

/**
 * The single source of truth for rendering a user's roles as coloured tags:
 * localized labels from {@link useRoleOptions} + the shared per-role pastel
 * palette. Used by the users-admin table and the profile modal so both stay
 * in sync — never re-implement the label/colour lookup per page.
 */
export default function RoleTags({ roles, emptyText }: RoleTagsProps) {
  const roleOptions = useRoleOptions();
  const roleLabelMap = useMemo(
    () =>
      Object.fromEntries(roleOptions.map(({ value, label }) => [value, label])),
    [roleOptions],
  );

  const list = roles ?? [];
  if (list.length === 0) {
    return emptyText ? (
      <span className="text-secondary">{emptyText}</span>
    ) : null;
  }

  return (
    <>
      {list.map((role) => {
        const color = ROLE_TAG_COLORS[role] ?? DEFAULT_ROLE_COLOR;
        return (
          <Tag
            key={role}
            style={{
              backgroundColor: color.bg,
              borderColor: color.border,
              color: color.text,
            }}
          >
            {roleLabelMap[role] ?? role}
          </Tag>
        );
      })}
    </>
  );
}
