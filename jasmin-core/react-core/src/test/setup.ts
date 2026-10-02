// Mirror the app's boot-time dayjs plugin registration (see main.tsx) so
// component/hook tests run against the same singleton the app has.
import "@shared/utils/dayjsSetup";
import "@testing-library/jest-dom/vitest";
// vitest-axe's `toHaveNoViolations`, so a render test can assert
// `expect(await axe(container)).toHaveNoViolations()` with the `axe` from
// `./axe` — the layer that catches rendered-DOM a11y issues jsx-a11y (static,
// raw JSX) can't see. The package's `extend-expect` entry registers nothing at
// runtime and types the matcher on the `Vi` namespace that vitest 3 no longer
// reads, so the matcher is registered with expect.extend and typed below.
import type { AxeMatchers } from "vitest-axe/matchers";
import * as axeMatchers from "vitest-axe/matchers";
import { afterAll, afterEach, beforeAll, expect, vi } from "vitest";
import { cleanup } from "@testing-library/react";

declare module "vitest" {
  interface Assertion<T = any> {
    toHaveNoViolations: AxeMatchers["toHaveNoViolations"];
  }
}

expect.extend(axeMatchers);

import { server } from "./msw/server";

// The Friendly Captcha SDK loads its widget and background agent in iframes
// from Friendly Captcha's servers, which a test must never reach. Pages that
// mount ``<FriendlyCaptcha>`` render nothing without
// ``tenant.friendly_captcha_sitekey`` (empty in tests), so they never touch
// the SDK; a test that renders the widget mocks the SDK itself.
vi.mock("@friendlycaptcha/sdk", () => ({}));

// MSW intercepts every HTTP call. Tests that don't expect any traffic stay
// quiet; tests that do supply handlers via `server.use(...)` per case.
// Custom warn callback so non-HTTP fetches (e.g. yoga.wasm pulled in by
// @react-pdf/renderer) don't dump a binary blob into the test output.
beforeAll(() =>
  server.listen({
    onUnhandledRequest: (req, print) => {
      const url = req.url;
      // Static assets / wasm binaries used by libraries during import.
      if (/\.(wasm|woff2?|ttf|otf|png|jpe?g|gif|svg)(\?|$)/.test(url)) return;
      print.error();
    },
  }),
);
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Reset DOM between tests so RTL components don't leak state.
// In a node-environment test file (e.g. PDF generation), window/localStorage
// don't exist, so guard each side-effect.
afterEach(() => {
  cleanup();
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
  vi.restoreAllMocks();
});

// AntD's Modal/Drawer measure the scrollbar width by reading the
// ``::-webkit-scrollbar`` pseudo-element via ``getComputedStyle(el, pseudoElt)``
// (rc-util ``getScrollBarSize``). jsdom has no layout engine and emits a noisy
// "Not implemented: window.getComputedStyle(elt, pseudoElt)" jsdomError for the
// pseudo-element form — it still returns a style object, so it is log noise, not
// a failure. Drop the pseudo argument so every modal-opening test falls back to
// the supported single-arg path (the measured scrollbar width is 0 in jsdom
// either way, since there is no real layout).
if (typeof window !== "undefined") {
  const realGetComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((element: Element) =>
    realGetComputedStyle(element)) as typeof window.getComputedStyle;
}

// Some libraries (antd, MUI) probe matchMedia. jsdom doesn't ship it.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
