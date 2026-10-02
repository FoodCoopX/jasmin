import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ newVersionAvailable: false }));

vi.mock("@shared/hooks/useNewVersionAvailable", () => ({
  useNewVersionAvailable: () => state.newVersionAvailable,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import NewVersionBanner from "../NewVersionBanner";

const originalLocation = window.location;
const reload = vi.fn();

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, reload },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  reload.mockReset();
  state.newVersionAvailable = false;
});

describe("NewVersionBanner", () => {
  it("renders nothing while the running build is current", () => {
    const { container } = render(<NewVersionBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it("offers a reload once a newer build is served", async () => {
    state.newVersionAvailable = true;
    render(<NewVersionBanner />);

    expect(screen.getByText("common.new_version_banner")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "common.reload" }),
    );

    expect(reload).toHaveBeenCalledOnce();
  });
});
