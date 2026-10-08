/**
 * ListPDFGenerator: the Download button of the list PDFs, which loads the PDF
 * library and the document on click, renders the document and hands the file
 * to the browser.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const { notifyMock, downloadBlobMock, toBlobMock } = vi.hoisted(() => ({
  notifyMock: { error: vi.fn() },
  downloadBlobMock: vi.fn(),
  toBlobMock: vi.fn(),
}));

vi.mock("@shared/utils", () => ({
  notify: notifyMock,
  downloadBlob: downloadBlobMock,
}));

vi.mock("@react-pdf/renderer", () => ({
  pdf: () => ({ toBlob: toBlobMock }),
}));

import ListPDFGenerator from "../ListPDFGenerator";

const ListDocument = () => null;

function renderButton() {
  render(
    <ListPDFGenerator
      data={[{ id: 1 }]}
      filename="washing-list"
      buttonText="Download"
      documentLoader={async () => ({ default: ListDocument })}
      documentProps={{}}
    />,
  );
}

beforeEach(() => {
  notifyMock.error.mockReset();
  downloadBlobMock.mockReset();
  toBlobMock.mockReset();
});

describe("ListPDFGenerator", () => {
  it("downloads the rendered list", async () => {
    const blob = new Blob(["%PDF"]);
    toBlobMock.mockResolvedValue(blob);
    renderButton();

    await userEvent.click(screen.getByRole("button", { name: /Download/ }));

    await waitFor(() =>
      expect(downloadBlobMock).toHaveBeenCalledWith(blob, "washing-list.pdf"),
    );
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it("tells the user when the PDF could not be generated", async () => {
    toBlobMock.mockRejectedValue(new Error("layout failed"));
    renderButton();

    await userEvent.click(screen.getByRole("button", { name: /Download/ }));

    await waitFor(() =>
      expect(notifyMock.error).toHaveBeenCalledWith("common.error_exporting"),
    );
    expect(downloadBlobMock).not.toHaveBeenCalled();
  });
});
