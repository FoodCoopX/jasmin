import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { RequireRole } from "./RequireRole";
import { useMemberSelfService } from "./useMemberSelfService";

/**
 * Whole-page guard for a member page routed with an ``:id`` member param: the
 * office opens every member's page, and a member — whatever staff roles they
 * also hold — their own.
 */
export function RequireOfficeOrOwnMember({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const ownPage = useMemberSelfService(id);
  if (ownPage) return <>{children}</>;
  return <RequireRole flag="isOffice">{children}</RequireRole>;
}
