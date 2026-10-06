import { renderHook } from "@testing-library/react";
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

import { useContactColumns } from "../useContactColumns";

describe("useContactColumns", () => {
  it("reads and writes the second phone number under the API's field name", () => {
    const { result } = renderHook(() =>
      useContactColumns({ translationPrefix: "resellers" }),
    );

    expect(result.current.phone2).toEqual(
      expect.objectContaining({ dataIndex: "phone_2", key: "phone_2" }),
    );
  });

  it("keeps the first phone number under its own field", () => {
    const { result } = renderHook(() => useContactColumns());

    expect(result.current.phone.dataIndex).toBe("phone");
  });
});
