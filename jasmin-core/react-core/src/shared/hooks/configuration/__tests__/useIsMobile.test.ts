import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useIsMobile } from "../useIsMobile";

const originalMatchMedia = window.matchMedia;

function fakeViewport(narrow: boolean) {
  let matches = narrow;
  const listeners = new Set<() => void>();
  window.matchMedia = vi.fn(
    () =>
      ({
        get matches() {
          return matches;
        },
        addEventListener: (_type: string, listener: () => void) =>
          listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) =>
          listeners.delete(listener),
      }) as unknown as MediaQueryList,
  );
  return {
    listeners,
    resize(toNarrow: boolean) {
      matches = toNarrow;
      listeners.forEach((listener) => listener());
    },
  };
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("useIsMobile", () => {
  it("is already true in the first render on a narrow viewport", () => {
    fakeViewport(true);
    const seen: boolean[] = [];

    renderHook(() => {
      const isMobile = useIsMobile();
      seen.push(isMobile);
      return isMobile;
    });

    expect(seen[0]).toBe(true);
  });

  it("follows the viewport when it changes", () => {
    const viewport = fakeViewport(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => viewport.resize(true));
    expect(result.current).toBe(true);

    act(() => viewport.resize(false));
    expect(result.current).toBe(false);
  });

  it("stops listening on unmount", () => {
    const viewport = fakeViewport(false);
    const { unmount } = renderHook(() => useIsMobile());
    expect(viewport.listeners.size).toBe(1);

    unmount();

    expect(viewport.listeners.size).toBe(0);
  });
});
