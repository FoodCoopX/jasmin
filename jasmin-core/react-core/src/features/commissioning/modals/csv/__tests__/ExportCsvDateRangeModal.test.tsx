/**
 * ExportCsvDateRangeModal: the shell behind the server-built CSV exports
 * (harvest, purchase, share weights, station fees, member register). The
 * office picks a date range, ticks any options, and the CSV the backend
 * writes in the tenant's CSV format is saved as it arrives. Rendered the way
 * its consumers host it: mounted closed, opened from a button, closed again
 * when it reports a close. The date-format and range-preset hooks and the CSV
 * download helper run; `fetchCsv` stands in for the generated export call,
 * and the browser download is recorded instead of saved.
 *
 * The clock is frozen on Wednesday 7 October 2026.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/test/profileRenders";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === "string" ? fallback : key),
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// Per-test tenant settings; anything unset falls back to the caller's default.
const tenantState = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }));
vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock({
    getSetting: (key: string, defaultValue?: unknown) =>
      key in tenantState.settings ? tenantState.settings[key] : defaultValue,
  });
  return { useTenant: () => tenant };
});

const { notify } = vi.hoisted(() => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@shared/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/utils")>()),
  notify,
}));

// The files the browser was handed to save.
const downloads = vi.hoisted(() => ({ files: [] as { name: string; blob: Blob }[] }));
vi.mock("@shared/utils/downloadBlob", () => ({
  downloadBlob: (blob: Blob, filename: string) => {
    downloads.files.push({ name: filename, blob });
  },
}));

import ExportCsvDateRangeModal, { type ExportCsvDateRangeOption } from "../ExportCsvDateRangeModal";

// ── Fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date(2026, 9, 7, 12, 0);

// What the backend writes for a German-format tenant: semicolons, decimal
// commas, day-first dates.
const SERVER_CSV = "Datum;Artikel;Menge\n05.10.2026;Karotten;12,5\n";

const SUMMED: ExportCsvDateRangeOption = {
  key: "summed",
  label: "Sum by share article",
  filenameSuffix: "_summiert",
};
const WITH_NOTES: ExportCsvDateRangeOption = {
  key: "with_notes",
  label: "With notes",
  defaultChecked: true,
};

const fetchCsv = vi.fn<(params: Record<string, unknown>) => Promise<unknown>>();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  tenantState.settings = {};
  downloads.files = [];
  Object.values(notify).forEach((fn) => fn.mockReset());
  fetchCsv.mockReset().mockResolvedValue(SERVER_CSV);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

const OPEN_EXPORT = "Export harvest";

function HarvestPage({
  onClose,
  options,
}: {
  onClose: () => void;
  options?: ExportCsvDateRangeOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {OPEN_EXPORT}
      </button>
      <ExportCsvDateRangeModal
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="Harvest export"
        filenamePrefix="harvest"
        fetchCsv={fetchCsv}
        options={options}
      />
    </>
  );
}

function renderPage(options?: ExportCsvDateRangeOption[]) {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<HarvestPage onClose={onClose} options={options} />);
  return { user, onClose };
}

type User = ReturnType<typeof userEvent.setup>;

const dialog = () => screen.getByRole("dialog");
const rangeInputs = () => within(dialog()).getAllByRole("textbox");
const downloadButton = () => within(dialog()).getByRole("button", { name: /common\.download/ });
const cancelButton = () => within(dialog()).getByRole("button", { name: "common.cancel" });

async function openExport(user: User) {
  await user.click(screen.getByRole("button", { name: OPEN_EXPORT }));
  return screen.findByRole("dialog");
}

function openCalendar(): HTMLElement {
  const open = Array.from(document.querySelectorAll<HTMLElement>(".ant-picker-dropdown")).filter(
    (dropdown) => !dropdown.classList.contains("ant-picker-dropdown-hidden"),
  );
  const calendar = open[open.length - 1];
  if (!calendar) throw new Error("No date picker is open");
  return calendar;
}

async function clickDay(user: User, isoDate: string) {
  const cell = await waitFor(() => {
    const found = openCalendar().querySelector<HTMLElement>(
      `td.ant-picker-cell-in-view[title="${isoDate}"]`,
    );
    if (!found) throw new Error(`No calendar cell for ${isoDate}`);
    return found;
  });
  await user.click(cell);
}

async function pickRange(user: User, from: string, to: string) {
  await user.click(rangeInputs()[0]);
  await clickDay(user, from);
  await clickDay(user, to);
  await waitFor(() => expect(downloadButton()).toBeEnabled());
}

/** Reads a file as the bytes the browser saves, a byte order mark included. */
function readFile(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(new TextDecoder("utf-8", { ignoreBOM: true }).decode(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function download(user: User) {
  await user.click(downloadButton());
  await waitFor(() => expect(downloads.files).toHaveLength(1));
  const [file] = downloads.files;
  return { name: file.name, type: file.blob.type, content: await readFile(file.blob) };
}

const serverError = () =>
  Object.assign(new Error("Request failed with status code 400"), {
    isAxiosError: true,
    response: { status: 400, data: { code: "invalid_date_range", message: "date_from must not be after date_to" } },
  });

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ExportCsvDateRangeModal", () => {
  it("opens without a range and offers no download until one is picked", async () => {
    const { user } = renderPage();

    await openExport(user);

    expect(within(dialog()).getByText("Harvest export")).toBeInTheDocument();
    expect(within(dialog()).getByText("common.select_date_range")).toBeInTheDocument();
    expect(rangeInputs().map((input) => (input as HTMLInputElement).value)).toEqual(["", ""]);
    expect(downloadButton()).toBeDisabled();
    await flushMicrotasks();
    expect(fetchCsv).not.toHaveBeenCalled();
  });

  it("shows the picked range in the tenant's date format", async () => {
    tenantState.settings = { date_format: "YYYY-MM-DD" };
    const { user } = renderPage();
    await openExport(user);

    await pickRange(user, "2026-10-05", "2026-10-16");

    expect(rangeInputs().map((input) => (input as HTMLInputElement).value)).toEqual([
      "2026-10-05",
      "2026-10-16",
    ]);
  });

  it("asks the server for the range and saves its CSV unchanged, named after the range", async () => {
    const { user, onClose } = renderPage();
    await openExport(user);
    await pickRange(user, "2026-10-05", "2026-10-16");
    expect(rangeInputs().map((input) => (input as HTMLInputElement).value)).toEqual([
      "05.10.2026",
      "16.10.2026",
    ]);

    const file = await download(user);

    expect(fetchCsv).toHaveBeenCalledTimes(1);
    expect(fetchCsv).toHaveBeenCalledWith({ date_from: "2026-10-05", date_to: "2026-10-16" });
    expect(file.name).toBe("harvest_2026-10-05_2026-10-16.csv");
    expect(file.type).toBe("text/csv;charset=utf-8;");
    expect(file.content).toBe(`﻿${SERVER_CSV}`);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("offers last month as a preset range", async () => {
    const { user } = renderPage();
    await openExport(user);

    await user.click(rangeInputs()[0]);
    await user.click(within(openCalendar()).getByText("common.last_month"));
    await waitFor(() => expect(downloadButton()).toBeEnabled());
    await download(user);

    expect(fetchCsv).toHaveBeenCalledWith({ date_from: "2026-09-01", date_to: "2026-09-30" });
  });

  it("sends every option as a flag, starting from its default", async () => {
    const { user } = renderPage([SUMMED, WITH_NOTES]);
    await openExport(user);

    expect(within(dialog()).getByRole("checkbox", { name: "Sum by share article" })).not.toBeChecked();
    expect(within(dialog()).getByRole("checkbox", { name: "With notes" })).toBeChecked();
    await pickRange(user, "2026-10-05", "2026-10-16");
    const file = await download(user);

    expect(fetchCsv).toHaveBeenCalledWith({
      date_from: "2026-10-05",
      date_to: "2026-10-16",
      summed: false,
      with_notes: true,
    });
    expect(file.name).toBe("harvest_2026-10-05_2026-10-16.csv");
  });

  it("sends a ticked option and adds its suffix to the file name", async () => {
    const { user } = renderPage([SUMMED, WITH_NOTES]);
    await openExport(user);
    await pickRange(user, "2026-10-05", "2026-10-16");

    await user.click(within(dialog()).getByRole("checkbox", { name: "Sum by share article" }));
    await user.click(within(dialog()).getByRole("checkbox", { name: "With notes" }));
    const file = await download(user);

    expect(fetchCsv).toHaveBeenCalledWith({
      date_from: "2026-10-05",
      date_to: "2026-10-16",
      summed: true,
      with_notes: false,
    });
    expect(file.name).toBe("harvest_2026-10-05_2026-10-16_summiert.csv");
  });

  it("locks the download while the server writes the CSV", async () => {
    let answer: (csv: string) => void = () => {};
    fetchCsv.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const { user, onClose } = renderPage();
    await openExport(user);
    await pickRange(user, "2026-10-05", "2026-10-16");

    await user.click(downloadButton());
    await waitFor(() => expect(downloadButton()).toHaveClass("ant-btn-loading"));
    await user.click(downloadButton());

    expect(fetchCsv).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    answer(SERVER_CSV);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(downloads.files).toHaveLength(1);
  });

  it("saves nothing and stays open with the range when the server refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchCsv.mockRejectedValue(serverError());
    const { user, onClose } = renderPage();
    await openExport(user);
    await pickRange(user, "2026-10-05", "2026-10-16");

    await user.click(downloadButton());

    await waitFor(() => expect(downloadButton()).not.toHaveClass("ant-btn-loading"));
    expect(downloads.files).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(downloadButton()).toBeEnabled();
    expect(rangeInputs().map((input) => (input as HTMLInputElement).value)).toEqual([
      "05.10.2026",
      "16.10.2026",
    ]);
  });

  it.skip("tells the office why the server refused the export", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchCsv.mockRejectedValue(serverError());
    const { user } = renderPage();
    await openExport(user);
    await pickRange(user, "2026-10-05", "2026-10-16");

    await user.click(downloadButton());

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith("date_from must not be after date_to"));
  });

  it("forgets the range and the ticked options when cancelled", async () => {
    const { user, onClose } = renderPage([SUMMED, WITH_NOTES]);
    await openExport(user);
    await pickRange(user, "2026-10-05", "2026-10-16");
    await user.click(within(dialog()).getByRole("checkbox", { name: "Sum by share article" }));
    await user.click(within(dialog()).getByRole("checkbox", { name: "With notes" }));

    await user.click(cancelButton());
    expect(onClose).toHaveBeenCalledTimes(1);
    await openExport(user);

    expect(rangeInputs().map((input) => (input as HTMLInputElement).value)).toEqual(["", ""]);
    expect(downloadButton()).toBeDisabled();
    expect(within(dialog()).getByRole("checkbox", { name: "Sum by share article" })).not.toBeChecked();
    expect(within(dialog()).getByRole("checkbox", { name: "With notes" })).toBeChecked();
    expect(fetchCsv).not.toHaveBeenCalled();
  });
});
