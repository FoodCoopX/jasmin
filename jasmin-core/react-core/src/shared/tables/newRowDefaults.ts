import type { FormInstance } from "antd";

import type { TableRecord } from "./BasicEditableTable/types";

/** An ``EditableTable`` ``customEdit`` that opens a new row (``key === -1``)
 * with ``defaults`` filled in and leaves a saved row as it is. */
export function withNewRowDefaults<TRow extends TableRecord>(
  defaults: Record<string, unknown>,
) {
  return (record: TRow, form: Pick<FormInstance, "setFieldsValue">): TRow => {
    if (record.key !== -1) return record;
    form.setFieldsValue(defaults);
    return { ...record, ...defaults };
  };
}
