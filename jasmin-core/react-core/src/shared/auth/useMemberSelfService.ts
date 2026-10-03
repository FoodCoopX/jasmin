import { useAuth } from "@shared/contexts/AuthContext";
import { useRoles } from "./useRoles";

/**
 * Whether the viewer acts for themselves as ``memberId``'s member: the
 * member's self-service view, through the endpoints that act for the session's
 * own member (their own data, SEPA mandate, subscriptions, coop shares). That
 * is any viewer whose own member record it is, whatever staff roles they also
 * hold, except office users — they get the office view on every member page,
 * their own included.
 */
export function useMemberSelfService(
  memberId: string | null | undefined,
): boolean {
  const { isOffice } = useRoles();
  const { user } = useAuth();
  const ownMemberId = user?.member_id;
  return (
    !isOffice &&
    memberId != null &&
    ownMemberId != null &&
    String(ownMemberId) === String(memberId)
  );
}
