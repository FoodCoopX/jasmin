import { InputNumber } from "antd";
import type { GetRef, InputNumberProps } from "antd";
import { forwardRef, useCallback } from "react";

import { useNumberFormat } from "@hooks/useNumberFormat";
import { normalizeNumberInputText } from "@shared/utils/numberFormat";

export type NumberInputProps = Omit<
  InputNumberProps<number>,
  "decimalSeparator" | "parser" | "formatter" | "stringMode"
>;

/**
 * AntD's ``InputNumber`` in the tenant's number format, for every number field.
 * It shows the tenant's decimal mark ("1,50" on a German tenant) and reads "."
 * and "," alike, with or without thousands grouping, as
 * ``normalizeNumberInputText`` describes. The value is a plain JS number
 * whatever the format; only the text in the field is localized. AntD's own
 * ``InputNumber`` reads only a "." and drops every other character, so a typed
 * "2,50" becomes 250 there; eslint.config.js forbids importing it anywhere but
 * here.
 *
 * Phones open a number keypad: ``inputMode`` "numeric" for whole numbers
 * (``precision`` 0), "decimal" otherwise. The iOS keypads have no minus key, so
 * a field that takes negative numbers passes ``inputMode="text"``.
 *
 * Needs the ``TenantProvider``: the tenant's format comes through
 * ``useTenant``, which throws outside one, and the super-admin app has none.
 */
const NumberInput = forwardRef<GetRef<typeof InputNumber>, NumberInputProps>(
  function NumberInput(props, ref) {
    const { decimalChar } = useNumberFormat().separators;
    // InputNumber reads what its parser returns as text: "" keeps a cleared
    // field empty (null) instead of 0, and no digit is lost to a float.
    const parser = useCallback(
      (text: string | undefined) =>
        normalizeNumberInputText(text ?? "", decimalChar) as unknown as number,
      [decimalChar],
    );
    return (
      <InputNumber<number>
        inputMode={props.precision === 0 ? "numeric" : "decimal"}
        {...props}
        ref={ref}
        decimalSeparator={decimalChar}
        parser={parser}
      />
    );
  },
);

export default NumberInput;
