/**
 * Thrown from a table's `customSave` to refuse the row: the table keeps it in
 * edit mode, shows `message` above the table and marks each field in
 * `fieldErrors` (field name → message). A plain `Error` refuses the row too,
 * but marks no field.
 */
export class RowSaveRefused extends Error {
  readonly fieldErrors: Record<string, string>;

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "RowSaveRefused";
    this.fieldErrors = fieldErrors;
  }
}
