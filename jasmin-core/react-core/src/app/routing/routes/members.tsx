import { lazy } from "react";
import {
  RequireCapability,
  RequireMembersAndSubscriptions,
  RequireOfficeOrOwnMember,
  RequireRole,
} from "@shared/auth";
import type { AppRoute } from "../types";

const DashboardMembers = lazy(
  () => import("@/features/members/pages/DashboardMembers"),
);
const Members = lazy(() => import("@features/members/pages/Members"));
const MemberDetail = lazy(() => import("@features/members/pages/MemberDetail"));

const MemberLoans = lazy(() => import("@features/members/pages/MemberLoans"));
const StaffDetail = lazy(() => import("@features/members/pages/StaffDetail"));
// Member-lifecycle / communication views that live in the Members feature: the
// GDPR deletion-request queue and the email history are per-member operational
// tools, not tenant settings. (The GDPR *settings* — privacy policy + Art. 30
// VVT — stay on the Configuration GDPR page.)
const GdprDeletionRequests = lazy(
  () => import("@features/members/pages/GdprDeletionRequests"),
);
const EmailLog = lazy(() => import("@/features/members/pages/EmailLog"));

export const membersRoutes: AppRoute[] = [
  {
    path: "/members/dashboard",
    element: (
      <RequireMembersAndSubscriptions>
        <RequireRole flag="isOffice">
          <DashboardMembers />
        </RequireRole>
      </RequireMembersAndSubscriptions>
    ),
  },

  {
    path: "/members/staff-detail",
    element: (
      <RequireMembersAndSubscriptions>
        <RequireRole flag="isOffice">
          <StaffDetail />
        </RequireRole>
      </RequireMembersAndSubscriptions>
    ),
  },
  {
    path: "/members/members",
    element: (
      <RequireMembersAndSubscriptions>
        <RequireRole flag="isOffice">
          <Members />
        </RequireRole>
      </RequireMembersAndSubscriptions>
    ),
  },
  {
    // Also a member's own page, for one who holds staff roles too: their menu
    // links it in every mode, so the import-shares mode doesn't close it.
    path: "/members/members/:id",
    element: (
      <RequireOfficeOrOwnMember>
        <MemberDetail />
      </RequireOfficeOrOwnMember>
    ),
  },

  {
    path: "/members/loans",
    element: (
      <RequireMembersAndSubscriptions>
        <RequireRole flag="isOffice">
          <MemberLoans />
        </RequireRole>
      </RequireMembersAndSubscriptions>
    ),
  },

  {
    // Every email the farm sends, the resellers' included, so the
    // import-shares mode doesn't close it.
    path: "/members/email-log",
    element: (
      <RequireRole flag="isOffice">
        <EmailLog />
      </RequireRole>
    ),
  },
  {
    // Customers file deletion requests too, and the office's mail about one
    // links here in every mode, so the import-shares mode doesn't close it.
    path: "/members/data-protection",
    element: (
      <RequireCapability name="gdpr">
        <RequireRole flag="isAdmin">
          <GdprDeletionRequests />
        </RequireRole>
      </RequireCapability>
    ),
  },
];
