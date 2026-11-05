/**
 * The privacy options of the error reports: the secret of a mailed link is
 * blanked wherever the SDK keeps a URL path, every route and API path with a
 * parameter not known to be harmless is covered, and a report the real SDK
 * sends through them carries no token, query string or Referer.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as Sentry from "@sentry/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ERROR_REPORT_PRIVACY, scrubSecretPaths } from "../errorReportPrivacy";

const REACT_CORE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__") yield* sourceFiles(full);
    } else if (/\.(tsx|jsx|ts)$/.test(entry)) {
      yield full;
    }
  }
}

/** The route paths of the app, as ``path="…"`` and ``path: "…"`` spell them. */
function routePaths(): string[] {
  const paths: string[] = [];
  for (const dir of ["src/app", "src/features"]) {
    for (const file of sourceFiles(join(REACT_CORE, dir))) {
      for (const match of readFileSync(file, "utf8").matchAll(/\bpath(?:=|:\s*)["']([^"']+)["']/g)) {
        paths.push(match[1]);
      }
    }
  }
  return paths;
}

/** The API paths of the OpenAPI schema. */
function apiPaths(): string[] {
  return [...readFileSync(join(REACT_CORE, "schema.yml"), "utf8").matchAll(/^ {2}(\/api\/\S+):$/gm)].map(
    (match) => match[1],
  );
}

// The path parameters reviewed as no secret; any other one must be scrubbed.
const NON_SECRET_PARAMS = new Set([
  "id",
  "slug",
  "resellerId",
  "composite_id",
  "request_id",
  "user_id",
  "member_id",
  "reseller_id",
]);

/** ``path`` with each parameter (``param`` matches one and names it) filled
 * in: ``s3cret`` for one not known to be harmless, else ``1``. ``null`` when
 * every parameter is known to be harmless. */
function withSecretsFilledIn(path: string, param: RegExp): string | null {
  let hasSecret = false;
  const filled = path.replace(param, (_match, name: string) => {
    if (NON_SECRET_PARAMS.has(name)) return "1";
    hasSecret = true;
    return "s3cret";
  });
  return hasSecret ? filled : null;
}

describe("scrubSecretPaths", () => {
  it.each([
    ["/set-password/tok3n", "/set-password/<token>"],
    ["/reset-password/MQ/tok3n", "/reset-password/<token>"],
    ["/gdpr/confirm-deletion/tok3n", "/gdpr/confirm-deletion/<token>"],
    ["/waiting-list-offer/tok3n", "/waiting-list-offer/<token>"],
    ["/api/auth/invitations/tok3n/", "/api/auth/invitations/<token>/"],
    ["/api/gdpr/confirm-deletion/tok3n/", "/api/gdpr/confirm-deletion/<token>/"],
    [
      "/api/commissioning/waiting_list_offers/tok3n/accept/",
      "/api/commissioning/waiting_list_offers/<token>/accept/",
    ],
    ["https://farm.example/set-password/tok3n#form", "https://farm.example/set-password/<token>#form"],
    [
      "Failed on /waiting-list-offer/tok3n and /waiting-list-offer/t0ken again",
      "Failed on /waiting-list-offer/<token> and /waiting-list-offer/<token> again",
    ],
  ])("blanks the secret in %s", (url, scrubbed) => {
    expect(scrubSecretPaths(url)).toBe(scrubbed);
  });

  it("leaves every other path as it is", () => {
    for (const url of [
      "/members/members/MeMbEr000001",
      "/api/auth/invitations/accept/",
      "/commissioning/planning/harvest",
      "/api/commissioning/resellers/",
      "https://farm.example/login",
    ]) {
      expect(scrubSecretPaths(url)).toBe(url);
    }
  });

  it("covers every route with a parameter not known to be harmless", () => {
    const secretRoutes = routePaths().flatMap((path) => withSecretsFilledIn(path, /:(\w+)/g) ?? []);
    expect(secretRoutes.length).toBeGreaterThan(0);
    for (const route of secretRoutes) {
      expect(scrubSecretPaths(route), route).not.toContain("s3cret");
    }
  });

  it("covers every API path with a parameter not known to be harmless", () => {
    const secretPaths = apiPaths().flatMap((path) => withSecretsFilledIn(path, /\{(\w+)\}/g) ?? []);
    expect(secretPaths.length).toBeGreaterThan(0);
    for (const path of secretPaths) {
      expect(scrubSecretPaths(path), path).not.toContain("s3cret");
    }
  });
});

describe("an error report sent with the privacy options", () => {
  let sent: unknown[] = [];

  /** The error events among the envelopes sent: ``[header, [[item, event]]]``. */
  const sentEvents = () =>
    sent.map((envelope) => (envelope as [unknown, [unknown, Sentry.ErrorEvent][]])[1][0][1]);

  beforeEach(() => {
    sent = [];
    Sentry.init({
      dsn: "https://public@errors.example/1",
      ...ERROR_REPORT_PRIVACY,
      transport: () => ({
        send: async (envelope) => {
          sent.push(envelope);
          return {};
        },
        flush: async () => true,
      }),
    });
  });

  afterEach(async () => {
    await Sentry.close();
    window.history.replaceState({}, "", "/");
    Reflect.deleteProperty(document, "referrer");
  });

  it("carries no token, query string or Referer, and keeps the User-Agent", async () => {
    Object.defineProperty(document, "referrer", {
      value: "https://farm.example/reset-password/MQ/tok3n",
      configurable: true,
    });

    window.history.pushState({}, "", "/set-password/tok3n?next=%2Fhome");
    Sentry.addBreadcrumb({
      category: "fetch",
      data: { method: "GET", url: "/api/auth/invitations/tok3n/" },
    });
    Sentry.captureException(new Error("The password form broke"));
    await Sentry.flush(1000);

    const report = JSON.stringify(sent);
    expect(report).toContain("The password form broke");
    expect(report).toContain("/set-password/<token>");
    expect(report).toContain("/api/auth/invitations/<token>/");
    expect(report).toContain("User-Agent");
    expect(report).not.toContain("tok3n");
    expect(report).not.toContain("next=");
  });

  it("blanks the token in the frame made up from the page address", async () => {
    window.history.pushState({}, "", "/waiting-list-offer/tok3n?from=mail");
    // The browser's own call for an error without a stack: once for an inline
    // script, which it names by the page address, and once with no file.
    globalThis.onerror?.("Thrown by an inline script", window.location.href, 1, 1);
    globalThis.onerror?.("Thrown without a file", "", 0, 0);
    await Sentry.flush(1000);

    const frameFiles = sentEvents().map(
      (event) => event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename,
    );
    const scrubbedPage = `${window.location.origin}/waiting-list-offer/<token>`;
    expect(frameFiles).toEqual([scrubbedPage, scrubbedPage]);
    expect(JSON.stringify(sent)).not.toContain("tok3n");
  });
});
