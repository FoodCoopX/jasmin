import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

import { TenantContext } from "@shared/contexts/TenantContext";
import { useCapability } from "../useCapability";

function providing(tenant: Record<string, unknown> | null) {
  // Only ``tenant`` matters to the hook; the rest of the context is unused.
  const value = { tenant } as unknown as Parameters<
    typeof TenantContext.Provider
  >[0]["value"];
  return ({ children }: { children: ReactNode }) => (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}

describe("useCapability", () => {
  it("reports a capability the payload turns off", () => {
    const { result } = renderHook(() => useCapability("gdpr"), {
      wrapper: providing({ capabilities: { gdpr: false, user_accounts: true } }),
    });

    expect(result.current).toBe(false);
  });

  it("reports a capability the payload offers", () => {
    const { result } = renderHook(() => useCapability("user_accounts"), {
      wrapper: providing({ capabilities: { gdpr: false, user_accounts: true } }),
    });

    expect(result.current).toBe(true);
  });

  it("offers everything while no tenant has loaded", () => {
    const { result } = renderHook(() => useCapability("support_tickets"), {
      wrapper: providing(null),
    });

    expect(result.current).toBe(true);
  });

  it("offers everything for a payload from a backend that sends no capabilities", () => {
    const { result } = renderHook(() => useCapability("support_tickets"), {
      wrapper: providing({ name: "Farm" }),
    });

    expect(result.current).toBe(true);
  });

  it("offers everything outside a tenant provider", () => {
    const { result } = renderHook(() => useCapability("gdpr"));

    expect(result.current).toBe(true);
  });
});
