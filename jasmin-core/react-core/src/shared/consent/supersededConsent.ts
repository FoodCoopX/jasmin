/**
 * ``revoked_reason`` the server stores on a consent it closed because a newer
 * one of the same kind replaced it, as when a member re-signs their SEPA
 * mandate. A withdrawal's reason is free text, so the token tells them apart.
 */
const SUPERSEDED_REASON = "superseded";

export const isSupersededConsent = (record: {
  revoked_reason?: string | null;
}): boolean => record.revoked_reason === SUPERSEDED_REASON;
