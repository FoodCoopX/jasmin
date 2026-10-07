/**
 * The washing list's phone card: the article and its size, the total wash
 * amount as the list has already written it, the note, and a tap that opens
 * the row's edit dialog.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TableRecord } from "@shared/tables/BasicEditableTable/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { WashingMobileCard } from "../WashingMobileCard";

function washRow(overrides: Partial<TableRecord> = {}): TableRecord {
  return {
    key: "w-leeks",
    id: "w-leeks",
    share_article_name: "Leeks",
    size: "M",
    computed_total_wash_amount_text: "12,50 kg",
    note: "Trim the roots",
    ...overrides,
  };
}

const onEdit = vi.fn();

beforeEach(() => {
  onEdit.mockReset();
});

function renderCard(record: TableRecord = washRow(), editable = true) {
  return render(
    <WashingMobileCard record={record} onEdit={editable ? onEdit : undefined} />,
  );
}

const card = () => document.querySelector<HTMLElement>(".mobile-card-item")!;

describe("WashingMobileCard contents", () => {
  it("shows the article, then the wash amount, then the note", () => {
    renderCard();

    const lines = Array.from(
      card().querySelector(".mobile-card-content")!.children,
    ).map((line) => line.textContent);
    expect(lines).toEqual(["Leeks", "12,50 kg", "Trim the roots"]);
    expect(screen.getByText("Trim the roots")).toHaveClass("text-meta");
  });

  it("leaves out the wash amount and the note where the row has none", () => {
    renderCard(washRow({ computed_total_wash_amount_text: "", note: null }));

    const lines = Array.from(
      card().querySelector(".mobile-card-content")!.children,
    ).map((line) => line.textContent);
    expect(lines).toEqual(["Leeks"]);
  });

  it.each([
    ["S", "commissioning.small"],
    ["L", "commissioning.large"],
  ])("labels size %s after the article name", (size, label) => {
    renderCard(washRow({ size }));

    expect(screen.getByText(label)).toHaveClass("text-hint");
  });

  it("shows no size label for the default size M or a missing size", () => {
    const { unmount } = renderCard();
    expect(card().querySelector(".text-hint")).toBeNull();
    unmount();

    renderCard(washRow({ size: null }));
    expect(card().querySelector(".text-hint")).toBeNull();
  });
});

describe("WashingMobileCard actions", () => {
  it("opens the row's edit dialog on a tap, Enter or Space", async () => {
    const user = userEvent.setup();
    const record = washRow();
    renderCard(record);

    await user.click(screen.getByText("12,50 kg"));
    expect(onEdit).toHaveBeenCalledWith(record);

    card().focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onEdit).toHaveBeenCalledTimes(3);
  });

  it("is a focusable button only when the row can be edited", async () => {
    const user = userEvent.setup();
    const { unmount } = renderCard();
    expect(screen.getByRole("button")).toBe(card());
    expect(card()).toHaveAttribute("tabindex", "0");
    unmount();

    renderCard(washRow(), false);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(card()).not.toHaveAttribute("tabindex");
    await user.click(screen.getByText("Leeks"));
    expect(onEdit).not.toHaveBeenCalled();
  });
});
