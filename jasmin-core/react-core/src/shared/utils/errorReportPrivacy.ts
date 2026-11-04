/**
 * What the error reports sent to GlitchTip leave out (GDPR).
 *
 * Every category the Sentry SDK knows is collected unless turned off:
 * ``userInfo`` off also stops the server inferring the IP, URL query strings
 * and the Referer can carry tokens, and of the headers only the User-Agent
 * stays, for the browser and OS. A user can be attached per event via
 * ``Sentry.setUser({...})`` after a logged-in session, behind whatever consent
 * gating applies.
 *
 * The secret of a mailed link sits in the URL path, which the SDK keeps — in
 * the page URL of an event, in the stack frame it makes up from the page
 * address for an error without one, and in the navigation, fetch and XHR
 * breadcrumbs — so the hooks below blank it there, and in the error texts.
 */

import type { Breadcrumb, BrowserOptions, ErrorEvent } from "@sentry/react";

// The paths that carry a secret: the pages a mailed link opens and the API
// calls they make. Each keeps its prefix (the group) and loses what follows;
// ``/gdpr/confirm-deletion/`` matches its API path too, and the invitation's
// ``accept/`` takes its token in the body.
const SECRET_PATHS: RegExp[] = [
  /(\/set-password\/)[^/?#\s]+/g,
  /(\/reset-password\/)[^/?#\s]+\/[^/?#\s]+/g,
  /(\/gdpr\/confirm-deletion\/)[^/?#\s]+/g,
  /(\/waiting-list-offer\/)[^/?#\s]+/g,
  /(\/api\/auth\/invitations\/)(?!accept\/)[^/?#\s]+/g,
  /(\/api\/commissioning\/waiting_list_offers\/)[^/?#\s]+/g,
];

/** ``text`` with the secret in a mailed link's URL path replaced by
 * ``<token>``, as the backend's error reports write it; anything else comes
 * back unchanged. */
export function scrubSecretPaths(text: string): string {
  return SECRET_PATHS.reduce(
    (scrubbed, secretPath) => scrubbed.replace(secretPath, "$1<token>"),
    text,
  );
}

function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request?.url) {
    event.request.url = scrubSecretPaths(event.request.url);
  }
  if (event.message) event.message = scrubSecretPaths(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubSecretPaths(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) {
      // The frame made up from the page address keeps its query string.
      if (frame.filename) {
        frame.filename = scrubSecretPaths(frame.filename.replace(/\?[^#]*/, ""));
      }
    }
  }
  return event;
}

// Navigation breadcrumbs carry ``from`` and ``to``, fetch and XHR ones ``url``;
// the one the SDK leaves for a sent error repeats its text as the message.
function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.message) {
    breadcrumb.message = scrubSecretPaths(breadcrumb.message);
  }
  const data = breadcrumb.data;
  if (!data) return breadcrumb;
  for (const key of ["url", "from", "to"]) {
    const value = data[key];
    if (typeof value === "string") data[key] = scrubSecretPaths(value);
  }
  return breadcrumb;
}

export const ERROR_REPORT_PRIVACY = {
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { allow: ["User-Agent"] },
    httpBodies: [],
    urlQueryParams: false,
  },
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
} satisfies BrowserOptions;
