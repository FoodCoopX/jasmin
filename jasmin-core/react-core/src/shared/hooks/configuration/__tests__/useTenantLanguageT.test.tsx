import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const i18nState = vi.hoisted(() => ({ loaded: new Set<string>(["de"]) }));

// The translator answers in the language it was asked for, so the test reads
// which language the hook picked.
vi.mock("react-i18next", () => ({
  useTranslation: (_ns?: unknown, options?: { lng?: string }) => ({
    t: (key: string) => `${options?.lng ?? "reader"}:${key}`,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@shared/i18n", () => ({
  default: {
    hasResourceBundle: (code: string) => i18nState.loaded.has(code),
  },
  loadLanguageBundle: async (code: string) => {
    i18nState.loaded.add(code);
    return true;
  },
}));

import { TenantContext } from "@shared/contexts/TenantContext";
import { useTenantLanguageT } from "../useTenantLanguageT";

function providing(tenant: Record<string, unknown> | null) {
  // Only ``tenant`` matters to the hook; the rest of the context is unused.
  const value = { tenant } as unknown as Parameters<
    typeof TenantContext.Provider
  >[0]["value"];
  return ({ children }: { children: ReactNode }) => (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}

beforeEach(() => {
  i18nState.loaded = new Set(["de"]);
});

describe("useTenantLanguageT", () => {
  it("speaks the farm's language, not the reader's", () => {
    const { result } = renderHook(() => useTenantLanguageT(), {
      wrapper: providing({ tenant_language: "de" }),
    });

    expect(result.current("commissioning.purchased_name_suffix")).toBe(
      "de:commissioning.purchased_name_suffix",
    );
  });

  it("speaks German until the farm's language has loaded", async () => {
    const { result } = renderHook(() => useTenantLanguageT(), {
      wrapper: providing({ tenant_language: "fr-CH" }),
    });

    expect(result.current("key")).toBe("de:key");
    await waitFor(() => expect(result.current("key")).toBe("fr:key"));
  });

  it("speaks German outside a farm", () => {
    const { result } = renderHook(() => useTenantLanguageT());

    expect(result.current("key")).toBe("de:key");
  });
});
