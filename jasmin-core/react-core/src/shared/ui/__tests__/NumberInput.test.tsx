/**
 * NumberInput: AntD's InputNumber in the tenant's number format. Rendered for
 * real, with the tenant's settings mocked per test; a tenant that sets no
 * number format gets the German one.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "antd";
import type { FormInstance } from "antd";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The tenant's settings, per test; an unset setting falls back to the caller's default.
const tenantSettings = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));
vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock({
    getSetting: (key: string, defaultValue?: unknown) =>
      key in tenantSettings.values ? tenantSettings.values[key] : defaultValue,
  });
  return { useTenant: () => tenant };
});

import NumberInput from "../NumberInput";
import type { NumberInputProps } from "../NumberInput";

/** A field that holds its own value, as the offer and harvest dialogs do. */
function AmountField({
  initial = null,
  onChange,
  ...props
}: NumberInputProps & {
  initial?: number | null;
  onChange: (value: number | null) => void;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <NumberInput
        aria-label="Amount"
        {...props}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
      <button type="button">Done</button>
    </>
  );
}

const amount = () => screen.getByRole("spinbutton", { name: "Amount" });

function renderAmount(props: Partial<Parameters<typeof AmountField>[0]> = {}) {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<AmountField onChange={onChange} {...props} />);
  // Leaving the field: it reads its text then and shows the value formatted.
  const leave = () => user.click(screen.getByRole("button", { name: "Done" }));
  return { user, onChange, leave };
}

beforeEach(() => {
  tenantSettings.values = {};
});

describe("NumberInput showing a value", () => {
  it.each([
    ["de-DE", "1,50"],
    ["fr-FR", "1,50"],
    ["en-US", "1.50"],
    ["de-CH", "1.50"],
  ])("shows it with the decimal mark of %s", (locale, shown) => {
    tenantSettings.values = { number_locale: locale };
    renderAmount({ initial: 1.5, precision: 2 });

    expect(amount()).toHaveValue(shown);
  });

  it("uses the German format when the tenant has set none", () => {
    renderAmount({ initial: 1.5, precision: 2 });

    expect(amount()).toHaveValue("1,50");
  });
});

describe("NumberInput reading what is typed", () => {
  it.each(["de-DE", "en-US"])(
    "%s: reads a decimal comma and a decimal point alike",
    async (locale) => {
      tenantSettings.values = { number_locale: locale };
      const { user, onChange } = renderAmount();

      await user.type(amount(), "2,50");
      expect(onChange).toHaveBeenLastCalledWith(2.5);

      await user.clear(amount());
      await user.type(amount(), "3.75");
      expect(onChange).toHaveBeenLastCalledWith(3.75);
    },
  );

  it("shows a typed amount in the tenant's format once the field is left", async () => {
    tenantSettings.values = { number_locale: "de-DE" };
    const { user, onChange, leave } = renderAmount({ step: 0.01 });

    await user.type(amount(), "2.5");
    await leave();

    expect(amount()).toHaveValue("2,50");
    expect(onChange).toHaveBeenLastCalledWith(2.5);
    // Screen readers get the canonical number.
    expect(amount()).toHaveAttribute("aria-valuenow", "2.5");
  });

  it.each([
    ["de-DE", "1.234,56", 1234.56],
    ["en-US", "1,234.56", 1234.56],
    ["en-US", "1,000", 1000],
    ["fr-FR", "1 234,56", 1234.56],
  ])("%s: reads a pasted %j with its grouping as %d", async (locale, pasted, expected) => {
    tenantSettings.values = { number_locale: locale };
    const { user, onChange } = renderAmount();

    await user.click(amount());
    await user.paste(pasted);

    expect(onChange).toHaveBeenLastCalledWith(expected);
  });

  it("rounds a fraction typed into a whole-number field once it is left", async () => {
    const { user, onChange, leave } = renderAmount({ precision: 0 });

    await user.type(amount(), "1,5");
    await leave();

    expect(onChange).toHaveBeenLastCalledWith(2);
    expect(amount()).toHaveValue("2");
  });

  it("reads a cleared field as no value", async () => {
    const { user, onChange } = renderAmount({ initial: 4 });

    await user.clear(amount());

    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps the caller's bounds", async () => {
    const { user, onChange, leave } = renderAmount({ min: 0 });

    await user.type(amount(), "-2");
    await leave();

    expect(onChange).toHaveBeenLastCalledWith(0);
    expect(amount()).toHaveValue("0");
  });
});

describe("NumberInput on a phone", () => {
  it("opens a number keypad, without a decimal key for whole numbers, unless the caller picks another", () => {
    render(
      <>
        <NumberInput aria-label="Price" />
        <NumberInput aria-label="Count" precision={0} />
        <NumberInput aria-label="Offset" inputMode="text" />
      </>,
    );

    expect(screen.getByRole("spinbutton", { name: "Price" })).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByRole("spinbutton", { name: "Count" })).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByRole("spinbutton", { name: "Offset" })).toHaveAttribute("inputmode", "text");
  });
});

describe("NumberInput in a form", () => {
  it("is named by its form label, holds the canonical number, and the form reaches it through its ref", async () => {
    tenantSettings.values = { number_locale: "de-DE" };
    let form: FormInstance | undefined;
    function FeeForm() {
      const [instance] = Form.useForm();
      form = instance;
      return (
        <Form form={instance} initialValues={{ fee: "1.50" }}>
          <Form.Item name="fee" label="Fee">
            <NumberInput step={0.01} />
          </Form.Item>
          <button type="button">Done</button>
        </Form>
      );
    }
    const user = userEvent.setup();
    render(<FeeForm />);
    const fee = screen.getByLabelText("Fee");
    expect(fee).toHaveValue("1,50");

    await user.clear(fee);
    await user.type(fee, "2,75");
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(form?.getFieldValue("fee")).toBe(2.75);
    expect(fee).not.toHaveFocus();
    act(() => form?.getFieldInstance("fee").focus());
    expect(fee).toHaveFocus();
  });
});
