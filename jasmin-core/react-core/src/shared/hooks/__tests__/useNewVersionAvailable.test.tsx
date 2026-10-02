import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { server } from "@/test/msw/server";

import { useNewVersionAvailable } from "../useNewVersionAvailable";

function renderCheck() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useNewVersionAvailable(), { wrapper });
}

function serveBuild(buildId: string) {
  let requests = 0;
  server.use(
    http.get("/build.json", () => {
      requests += 1;
      return HttpResponse.json({ build_id: buildId });
    }),
  );
  return () => requests;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("useNewVersionAvailable", () => {
  it("stays false while the server serves the build this tab runs", async () => {
    vi.stubEnv("VITE_BUILD_ID", "abc1234");
    const requests = serveBuild("abc1234");

    const { result } = renderCheck();

    await waitFor(() => expect(requests()).toBe(1));
    expect(result.current).toBe(false);
  });

  it("turns true once the server serves a different build", async () => {
    vi.stubEnv("VITE_BUILD_ID", "abc1234");
    serveBuild("def5678");

    const { result } = renderCheck();

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("never asks in a build without an id", async () => {
    vi.stubEnv("VITE_BUILD_ID", "");
    const requests = serveBuild("def5678");

    const { result } = renderCheck();

    expect(result.current).toBe(false);
    expect(requests()).toBe(0);
  });

  it("stays false when the check fails", async () => {
    vi.stubEnv("VITE_BUILD_ID", "abc1234");
    let requests = 0;
    server.use(
      http.get("/build.json", () => {
        requests += 1;
        return new HttpResponse(null, { status: 404 });
      }),
    );

    const { result } = renderCheck();

    await waitFor(() => expect(requests).toBe(1));
    expect(result.current).toBe(false);
  });
});
