import { lazy } from "react";
import { RequireOfficeOrOwnMember, RequireRole } from "@shared/auth";
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
      <RequireRole flag="isOffice">
        <DashboardMembers />
      </RequireRole>
    ),
  },

  {
    path: "/members/staff-detail",
    element: (
      <RequireRole flag="isOffice">
        <StaffDetail />
      </RequireRole>
    ),
  },
  {
    path: "/members/members",
    element: (
      <RequireRole flag="isOffice">
        <Members />
      </RequireRole>
    ),
  },
  {
    // Also a member's own page, for one who holds staff roles too (their menu
    // links it).
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
      <RequireRole flag="isOffice">
        <MemberLoans />
      </RequireRole>
    ),
  },

  {
    path: "/members/email-log",
    element: (
      <RequireRole flag="isOffice">
        <EmailLog />
      </RequireRole>
    ),
  },
  {
    path: "/members/data-protection",
    element: (
      <RequireRole flag="isAdmin">
        <GdprDeletionRequests />
      </RequireRole>
    ),
  },
];
