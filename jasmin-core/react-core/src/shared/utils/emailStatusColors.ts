/**
 * Shared email-status color logic for the office email log
 * (EmailLog) and the per-member emails modal (MemberEmailsModal),
 * so a status renders the same tag color in both views.
 */

// Statuses where the office needs to look — red tag.
export const DANGER_STATUSES = new Set(["failed"]);
// Not sent yet, or held back by the tenant's hourly limit — orange tag.
export const WARN_STATUSES = new Set(["pending", "rate_limited"]);
// Deliberately not sent (onboarding mode): nothing went wrong, nothing to do.
export const NEUTRAL_STATUSES = new Set(["suppressed"]);

/** Tag color for an email log status: danger→red, warn→orange, neutral→grey
 *  (AntD ``default``), sent→blue. */
export function getEmailStatusColor(status: string): string {
  if (DANGER_STATUSES.has(status)) return "red";
  if (WARN_STATUSES.has(status)) return "orange";
  if (NEUTRAL_STATUSES.has(status)) return "default";
  return "blue";
}
