import type { TablePermissions } from "./types";

type RowRule<T> = boolean | ((record: T) => boolean) | undefined;

/** A per-row rule allows the row unless it is `false` or returns false. */
export const allowsRow = <T>(rule: RowRule<T>, record: T): boolean =>
  typeof rule === "function" ? rule(record) : rule !== false;

export const canEditRow = <T extends Record<string, unknown>>(
  permissions: TablePermissions<T>,
  record: T,
): boolean =>
  permissions.canEdit !== false && allowsRow(permissions.canEditRecord, record);

export const canDeleteRow = <T extends Record<string, unknown>>(
  permissions: TablePermissions<T>,
  record: T,
): boolean =>
  permissions.canDelete !== false &&
  allowsRow(permissions.canDeleteRecord, record);

/**
 * Whether any action is reachable, so the table needs its action column:
 * adding, or editing or deleting through the table-level permission or a
 * per-row rule. A per-row rule only narrows its table-level permission, so it
 * counts only where that isn't `false`.
 */
export const hasRowActions = <T extends Record<string, unknown>>(
  permissions: TablePermissions<T>,
): boolean =>
  Boolean(
    permissions.canAdd ||
      (permissions.canEdit !== false &&
        (permissions.canEdit || permissions.canEditRecord)) ||
      (permissions.canDelete !== false &&
        (permissions.canDelete || permissions.canDeleteRecord)),
  );
