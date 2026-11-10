import { afterEach, describe, expect, it, vi } from "vitest";
import { Quill } from "react-quill-new";
import "../SanitizingClipboard";

// A Word list item as Word puts it on the clipboard, carrying a handler.
const WORD_HTML = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:w="urn:schemas-microsoft-com:office:word">
<head><style>@list l0:level1 { mso-level-number-format:bullet; }</style></head>
<body>
<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·</span>Carrots<img src="x" onerror="window.pwned = true"></p>
</body></html>`;

describe("SanitizingClipboard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sanitizes Word list markup before Quill copies it into the page", () => {
    const createElement = document.createElement.bind(document);
    const created: HTMLElement[] = [];
    vi.spyOn(document, "createElement").mockImplementation(
      (tagName: string, options?: ElementCreationOptions) => {
        const element = createElement(tagName, options);
        created.push(element);
        return element;
      },
    );
    const quill = new Quill(createElement("div"));

    const delta = quill.clipboard.convert({ html: WORD_HTML });

    const listItems = created.filter((element) => element.tagName === "LI");
    expect(listItems.length).toBeGreaterThan(0);
    expect(listItems.some((item) => item.querySelector("[onerror]"))).toBe(
      false,
    );
    expect(delta.ops.some((op) => op.attributes?.list === "bullet")).toBe(true);
  });
});
