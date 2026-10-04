/**
 * ``HomeScreenSignInNotice``: an iPhone or iPad home-screen app keeps its own
 * sign-in, apart from Safari's, and its login page says so until the viewer
 * closes the note. Everywhere else the note doesn't show.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { HomeScreenSignInNotice } from "../HomeScreenSignInNotice";

const NOTE = "auth.login_card.home_screen_sign_in";

function runAsHomeScreenApp(standalone: boolean | undefined) {
  Object.defineProperty(navigator, "standalone", {
    value: standalone,
    configurable: true,
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  runAsHomeScreenApp(undefined);
});

describe("HomeScreenSignInNotice", () => {
  it("tells the home-screen app's viewer to sign in once more", () => {
    runAsHomeScreenApp(true);

    render(<HomeScreenSignInNotice />);

    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  it("shows nothing in a browser tab", () => {
    runAsHomeScreenApp(undefined);

    render(<HomeScreenSignInNotice />);

    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it("stays closed once the viewer closes it", async () => {
    runAsHomeScreenApp(true);
    const { unmount } = render(<HomeScreenSignInNotice />);

    await userEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    unmount();
    render(<HomeScreenSignInNotice />);
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });
});
