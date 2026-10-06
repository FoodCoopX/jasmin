import { render, screen } from "@testing-library/react";
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

const sentry = vi.hoisted(() => ({
  captureReactException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("@sentry/react", () => sentry);

import ErrorBoundary from "../ErrorBoundary";

function Crash({ error }: { error: Error }): never {
  throw error;
}

describe("ErrorBoundary", () => {
  const reload = vi.fn();

  beforeEach(() => {
    window.sessionStorage.clear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    // React logs every caught render error; keep the output readable.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sentry.captureReactException.mockClear();
    sentry.captureMessage.mockClear();
    reload.mockClear();
  });

  it("reports a render error with its component stack and shows the way out", () => {
    const error = new Error("Cannot read properties of undefined");

    render(
      <ErrorBoundary>
        <Crash error={error} />
      </ErrorBoundary>,
    );

    // The boundary reads the real i18n, which falls back to German.
    expect(
      screen.getByRole("button", { name: "Seite neu laden" }),
    ).toBeInTheDocument();
    expect(sentry.captureReactException).toHaveBeenCalledTimes(1);
    const [reported, info] = sentry.captureReactException.mock.calls[0];
    expect(reported).toBe(error);
    expect(info.componentStack).toContain("Crash");
  });

  it("reloads for a failed chunk import instead of reporting it as a crash", () => {
    render(
      <ErrorBoundary>
        <Crash error={new Error("Failed to fetch dynamically imported module: /assets/x.js")} />
      </ErrorBoundary>,
    );

    expect(reload).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureReactException).not.toHaveBeenCalled();
  });
});
