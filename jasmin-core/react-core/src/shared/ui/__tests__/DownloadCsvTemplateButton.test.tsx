// The CSV template button's upload: the import endpoint is mocked at the axios
// boundary, and the toasts are read off the shared `notify`.

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

const { notifyMock, postMock } = vi.hoisted(() => ({
  notifyMock: { success: vi.fn(), error: vi.fn() },
  postMock: vi.fn(),
}));

vi.mock("@shared/utils", () => ({
  notify: notifyMock,
  downloadBlob: vi.fn(),
}));

vi.mock("@shared/services/api", () => ({
  default: { post: postMock },
}));

import DownloadCsvTemplateButton from "../DownloadCsvTemplateButton";

const csvFile = () =>
  new File(["name\nCarrots\n"], "articles.csv", { type: "text/csv" });

function renderButton(onImported = vi.fn()) {
  const { container } = render(
    <DownloadCsvTemplateButton
      columns={[{ dataIndex: "name", title: "Name" }]}
      filename="articles"
      modelName="ShareArticle"
      onImported={onImported}
    />,
  );
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("No upload input rendered");
  return { input, onImported };
}

beforeEach(() => {
  notifyMock.success.mockReset();
  notifyMock.error.mockReset();
  postMock.mockReset();
});

describe("DownloadCsvTemplateButton upload", () => {
  it("confirms a fully successful import with a toast", async () => {
    postMock.mockResolvedValue({
      data: { successful: 3, failed: 0, errors: [] },
    });
    const { input, onImported } = renderButton();

    await userEvent.upload(input, csvFile());

    await waitFor(() =>
      expect(notifyMock.success).toHaveBeenCalledWith(
        "csv_upload.import_success",
      ),
    );
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it("reports a refused upload with the server's message", async () => {
    postMock.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: "The file is empty." } },
    });
    const { input, onImported } = renderButton();

    await userEvent.upload(input, csvFile());

    await waitFor(() =>
      expect(notifyMock.error).toHaveBeenCalledWith("The file is empty."),
    );
    expect(onImported).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
