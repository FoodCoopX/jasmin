/**
 * RichTextEditorModal: the editor for descriptions, delivery-day
 * instructions, the privacy policy and rich-text settings. It closes once the
 * caller's save is done and stays open with the text when the save fails.
 * Quill is replaced by a plain textarea; the rest is real.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// The canonical mock, with one `t` for every render as react-i18next keeps it:
// the editor re-validates its text whenever `t` changes, so a new `t` per
// render would re-render it forever.
const i18nMock = vi.hoisted(() => ({
  t: (key: string, fallback?: unknown) =>
    typeof fallback === "string" ? fallback : key,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: i18nMock.t,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-quill-new", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (content: string) => void;
  }) => (
    <textarea
      aria-label="Text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

import RichTextEditorModal from "../RichTextEditorModal";

function renderEditor(
  onSave: (content: string) => void | Promise<void>,
  props: { maxCharacters?: number } = {},
) {
  const onClose = vi.fn();
  render(
    <RichTextEditorModal
      visible
      value="Collect at the barn."
      onSave={onSave}
      onClose={onClose}
      {...props}
    />,
  );
  return { onClose };
}

const saveButton = () => screen.getByRole("button", { name: /common\.save/ });

async function replaceText(text: string) {
  const editor = screen.getByRole("textbox", { name: "Text" });
  await userEvent.clear(editor);
  await userEvent.type(editor, text);
}

describe("RichTextEditorModal", () => {
  it("opens with the stored text", () => {
    renderEditor(vi.fn());

    expect(screen.getByRole("textbox", { name: "Text" })).toHaveValue(
      "Collect at the barn.",
    );
  });

  it("closes only once the save is done, showing it is busy until then", async () => {
    let finishSave: () => void = () => {};
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const { onClose } = renderEditor(onSave);

    await replaceText("Collect at the farm shop.");
    await userEvent.click(saveButton());

    expect(onSave).toHaveBeenCalledWith("Collect at the farm shop.");
    expect(saveButton()).toHaveClass("ant-btn-loading");
    expect(onClose).not.toHaveBeenCalled();

    finishSave();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("stays open with the text when the save fails, ready for another try", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockResolvedValueOnce(undefined);
    const { onClose } = renderEditor(onSave);

    await replaceText("Collect at the farm shop.");
    await userEvent.click(saveButton());

    await waitFor(() => expect(saveButton()).not.toHaveClass("ant-btn-loading"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Text" })).toHaveValue(
      "Collect at the farm shop.",
    );

    await userEvent.click(saveButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenLastCalledWith("Collect at the farm shop.");
  });

  it("closes right away when the save returns nothing to wait for", async () => {
    const onSave = vi.fn();
    const { onClose } = renderEditor(onSave);

    await userEvent.click(saveButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith("Collect at the barn.");
  });

  it("closes from cancel without saving", async () => {
    const onSave = vi.fn();
    const { onClose } = renderEditor(onSave);

    await userEvent.click(screen.getByRole("button", { name: "common.cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("refuses to save a text over the character limit", async () => {
    const onSave = vi.fn();
    renderEditor(onSave, { maxCharacters: 10 });

    await replaceText("Far too long for the box.");

    expect(saveButton()).toBeDisabled();
  });
});
