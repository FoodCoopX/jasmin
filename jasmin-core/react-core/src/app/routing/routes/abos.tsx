import { lazy } from "react";
import { RequireMembersAndSubscriptions, RequireRole } from "@shared/auth";
import type { AppRoute } from "../types";

// Lazy load all abos components - only loaded when the specific route is accessed
const DashboardAbos = lazy(() => import("@features/abos/pages/DashboardAbos"));
const AbosEmails = lazy(() => import("@features/abos/pages/AbosEmails"));
const Abos = lazy(() => import("@features/abos/pages/Abos"));
const DebitsAbos = lazy(() => import("@features/abos/pages/DebitsAbos"));
const ChargesAbos = lazy(() => import("@features/abos/pages/ChargesAbos"));
const Jokers = lazy(() => import("@features/abos/pages/Jokers"));

const WaitingListAbos = lazy(
  () => import("@features/abos/pages/WaitingListAbos"),
);
const ShareDeliveries = lazy(
  () => import("@features/abos/pages/ShareDeliveries"),
);
const SepaMandates = lazy(() => import("@features/abos/pages/SepaMandates"));

export const abosRoutes: AppRoute[] = [
  {
    path: "/abos/dashboard",
    element: (
      <RequireMembersAndSubscriptions>
        <RequireRole flag="isOffice">
          <DashboardAbos />
        </RequireRole>
      </RequireMembersAndSubscriptions>
    ),
  },
  {
    path: "/abos/abos-emails",
    element: (
      <RequireMembersAndSubscriptions>
        <RequireRole flag="isOffice">
          <AbosEmails />
        </RequireRole>
      </RequireMembersAndSubscriptions>
    ),
  },
  {
    path: "/abos/share-deliveries",
    element: (
      <RequireMembersAndSubscriptions>
        <RequireRole flag="isOffice">
          <ShareDeliveries />
        </RequireRole>
      </RequireMembersAndSubscriptions>
    ),
  },
  {
    path: "/abos/abos",
    element: (
      <RequireMembersAndSubscriptions>
        <RequireRole flag="isOffice">
          <Abos />
        </RequireRole>
      </RequireMembersAndSubscriptions>
    ),
  },

  {
    path: "/abos/debits-abos",
    element: (
      <RequireMembersAndSubscriptions>
        <RequireRole flag="isOffice">
          <DebitsAbos />
        </RequireRole>
      </RequireMembersAndSubscriptions>
    ),
  },
  {
    path: "/abos/charges",
    element: (
      <RequireMembersAndSubscriptions>
        <RequireRole flag="isOffice">
          <ChargesAbos />
        </RequireRole>
      </RequireMembersAndSubscriptions>
    ),
  },
  {
    path: "/abos/jokers",
    element: (
      <RequireMembersAndSubscriptions>
        <RequireRole flag="isOffice">
          <Jokers />
        </RequireRole>
      </RequireMembersAndSubscriptions>
    ),
  },

  {
    path: "/abos/waiting-list-abos",
    element: (
      <RequireMembersAndSubscriptions>
        <RequireRole flag="isOffice">
          <WaitingListAbos />
        </RequireRole>
      </RequireMembersAndSubscriptions>
    ),
  },
  {
    path: "/abos/sepa-mandates",
    element: (
      <RequireMembersAndSubscriptions>
        <RequireRole flag="isOffice">
          <SepaMandates />
        </RequireRole>
      </RequireMembersAndSubscriptions>
    ),
  },
];
