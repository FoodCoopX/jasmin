import { useCallback, useMemo, useState } from "react";

import type { MemberRecord } from "@features/members/pages/types";

/** What the members list's "needs attention" chips filter by. */
export type MemberAttention = "members" | "coop" | "consent";

// The rows each chip keeps: members awaiting the office's confirmation,
// members with coop shares awaiting confirmation, and members who withdrew a
// consent the office hasn't reviewed yet.
const NEEDS_ATTENTION: Record<
  MemberAttention,
  (record: MemberRecord) => boolean
> = {
  members: (record) => !record.admin_confirmed && !record.admin_rejected_at,
  coop: (record) => Number(record.coop_shares_pending_count ?? 0) > 0,
  consent: (record) => Boolean(record.consent_withdrawn_at),
};

/**
 * The "needs attention" quick filter of the members list. Filters the loaded
 * rows client-side; toggling the active chip again restores the full list.
 */
export function useMemberAttentionFilter(data: MemberRecord[]) {
  const [attention, setAttention] = useState<MemberAttention | null>(null);
  const counts = useMemo(
    () => ({
      members: data.filter(NEEDS_ATTENTION.members).length,
      coop: data.filter(NEEDS_ATTENTION.coop).length,
      consent: data.filter(NEEDS_ATTENTION.consent).length,
    }),
    [data],
  );
  const rows = useMemo(
    () => (attention ? data.filter(NEEDS_ATTENTION[attention]) : data),
    [data, attention],
  );
  const toggle = useCallback(
    (chip: MemberAttention) =>
      setAttention((current) => (current === chip ? null : chip)),
    [],
  );
  return { attention, counts, rows, toggle };
}
