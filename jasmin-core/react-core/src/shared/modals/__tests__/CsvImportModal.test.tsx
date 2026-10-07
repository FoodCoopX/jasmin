/**
 * The list pages' CSV import affordance.
 *
 * What matters here: the button is gated on the tenant setting, and the modal
 * offers a DRY RUN, so an office user learns about a bad file before importing
 * it.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import api from "@shared/services/api";
import { CsvImportButton } from "../CsvImportModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.entity ? `${key}:${String(opts.entity)}` : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@shared/services/api", () => ({ default: { post: vi.fn() } }));

const COLUMNS = [
  { dataIndex: "name", title: "Name", required: true },
  { dataIndex: "number", title: "Number", inputType: "integer" },
  // Read-only display column — must not be documented or templated.
  { dataIndex: "iban_masked", title: "IBAN", readOnly: true },
];

function renderButton(
  props: Partial<React.ComponentProps<typeof CsvImportButton>> = {},
) {
  return render(
    <CsvImportButton
      uploadAllowed
      columns={COLUMNS}
      filename="things.csv"
      modelName="share_article"
      {...props}
    />,
  );
}

const open = async () =>
  userEvent.click(screen.getByRole("button", { name: "csv_upload.open" }));

describe("CsvImportButton", () => {
  it("renders nothing when the tenant disallows uploads", () => {
    const { container } = renderButton({ uploadAllowed: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a modal offering template, dry run AND import", async () => {
    renderButton();
    await open();
    // The dry run is the whole point of the change.
    expect(screen.getByText("csv_upload.validate")).toBeInTheDocument();
    expect(screen.getByText("download.csv_template")).toBeInTheDocument();
    expect(screen.getByText("csv_upload.button")).toBeInTheDocument();
  });

  it("titles the modal with the model's translated entity name", async () => {
    renderButton();
    await open();
    expect(
      screen.getByText("csv_upload.import_title:csv_upload.model.share_article"),
    ).toBeInTheDocument();
  });

  it("documents only columns the template will emit", async () => {
    renderButton({ help: { name: "the name", number: "the number" } });
    await open();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("number")).toBeInTheDocument();
    // readOnly columns are not importable serializer inputs — documenting one
    // would send the office chasing a column the backend rejects.
    expect(screen.queryByText("iban_masked")).not.toBeInTheDocument();
  });

  describe("upload", () => {
    const post = vi.mocked(api.post);
    const sentForm = () => post.mock.calls[0][1] as FormData;

    async function importFile() {
      post.mockResolvedValue({
        data: { model_name: "share_article", successful: 1, failed: 0, results: [], errors: [] },
      });
      await open();
      const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
      await userEvent.upload(
        inputs[inputs.length - 1],
        new File(["name\nTractor hire\n"], "things.csv", { type: "text/csv" }),
      );
      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    }

    it("sends the page's fixed values with the file", async () => {
      post.mockClear();
      renderButton({ fixedValues: { is_extra: true, default_movement_unit: "PCS" } });

      await importFile();

      expect(sentForm().get("model_name")).toBe("share_article");
      expect(JSON.parse(String(sentForm().get("fixed_values")))).toEqual({
        is_extra: true,
        default_movement_unit: "PCS",
      });
    });

    it("sends no fixed values when the page has none", async () => {
      post.mockClear();
      renderButton();

      await importFile();

      expect(sentForm().has("fixed_values")).toBe(false);
    });
  });
});
