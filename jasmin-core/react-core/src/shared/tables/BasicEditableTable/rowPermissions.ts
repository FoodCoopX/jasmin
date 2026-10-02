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
