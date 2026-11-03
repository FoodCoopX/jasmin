import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import HostSignInPage from "../HostSignInPage";

// In jsdom the page is its own top window, so the host page is this one.
const originalLocation = window.location;
const reload = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
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
  vi.restoreAllMocks();
});

describe("HostSignInPage", () => {
  it("reloads the host page once to renew the sign-in", () => {
    render(<HostSignInPage />);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText("auth.host_sign_in.title")).toBeInTheDocument();
  });

  it("offers the reload instead of looping when one just happened", async () => {
    sessionStorage.setItem("host-sign-in-reloaded-at", String(Date.now()));
    render(<HostSignInPage />);

    expect(reload).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "auth.host_sign_in.reload" }),
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again once the last reload is long enough ago", () => {
    sessionStorage.setItem(
      "host-sign-in-reloaded-at",
      String(Date.now() - 5 * 60_000),
    );
    render(<HostSignInPage />);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("doesn't reload by itself when it can't note the reload", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    render(<HostSignInPage />);

    expect(reload).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "auth.host_sign_in.reload" }),
    ).toBeInTheDocument();
  });
});
