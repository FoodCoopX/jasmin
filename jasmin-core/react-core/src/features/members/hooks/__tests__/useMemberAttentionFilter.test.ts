/**
 * The members list's "needs attention" filter counts and keeps the members
 * awaiting confirmation, those with coop shares awaiting confirmation, and
 * those who withdrew a consent the office hasn't reviewed.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MemberRecord } from "@features/members/pages/types";

import { useMemberAttentionFilter } from "../useMemberAttentionFilter";

const ROWS: MemberRecord[] = [
  { key: "a", id: "a", admin_confirmed: true },
  {
    key: "b",
    id: "b",
    admin_confirmed: true,
    consent_withdrawn_at: "2026-09-30T10:00:00Z",
  },
  { key: "c", id: "c", admin_confirmed: false, coop_shares_pending_count: 1 },
];

describe("useMemberAttentionFilter", () => {
  it("counts each kind of attention", () => {
    const { result } = renderHook(() => useMemberAttentionFilter(ROWS));

    expect(result.current.counts).toEqual({ members: 1, coop: 1, consent: 1 });
    expect(result.current.rows).toHaveLength(3);
  });

  it("keeps the members who withdrew a consent, and toggles back", () => {
    const { result } = renderHook(() => useMemberAttentionFilter(ROWS));

    act(() => result.current.toggle("consent"));
    expect(result.current.rows.map((row) => row.id)).toEqual(["b"]);

    act(() => result.current.toggle("consent"));
    expect(result.current.rows).toHaveLength(3);
  });
});
