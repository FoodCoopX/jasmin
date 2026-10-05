import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import DashboardEconomics from "../DashboardEconomics";

describe("DashboardEconomics", () => {
  it("shows the coming-soon placeholder", () => {
    const { container } = render(<DashboardEconomics />);

    expect(container.textContent).toBe("common.coming_soon");
  });
});
