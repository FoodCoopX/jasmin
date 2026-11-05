import {
  BgColorsOutlined,
  DownOutlined,
  GlobalOutlined,
  IdcardOutlined,
  LockOutlined,
  LogoutOutlined,
  SafetyOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Dropdown, Space } from "antd";
import type { MenuProps } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useCommissioningMembersRetrieve } from "@shared/api/generated/commissioning/commissioning";
import { useRoles } from "@shared/auth/useRoles";
import { useAuth } from "@shared/contexts/AuthContext";
import { useCapability, useIsMobile } from "@hooks/index";
import PreferenceButtons from "./PreferenceButtons";
import UserProfileModal, { type UserProfileTab } from "./UserProfileModal";
import { usePreferenceMenuItems } from "./usePreferenceMenuItems";

type MenuItem = NonNullable<MenuProps["items"]>[number];

/** The menu's groups, with a divider between each two that have entries. */
function joinWithDividers(groups: MenuItem[][]): MenuItem[] {
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) =>
      index === 0 ? group : [{ type: "divider" as const }, ...group],
    );
}

interface MenuUser {
  first_name?: string;
  firstName?: string;
  last_name?: string;
  username?: string;
  email?: string;
  member_id?: string | number | null;
}

/** The name the menu button shows: the first one the user carries. */
function displayNameOf(user: MenuUser | null): string {
  return (
    user?.first_name || user?.firstName || user?.username || user?.email || ""
  );
}

export default function UserMenu() {
  const { t } = useTranslation();
  const { user, isAuthenticated, logout } = useAuth();
  const { languageItems, themeItems } = usePreferenceMenuItems();
  const { hasMemberRole, isStaff, isMemberOnly } = useRoles();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<UserProfileTab>("profile");
  const offersUserAccounts = useCapability("user_accounts");
  const offersGdpr = useCapability("gdpr");
  // Where a host owns the logins and the data protection, only the language
  // and the theme are left for the menu; they then stand in the top bar as
  // buttons of their own. The staff's link to their member page goes with the
  // menu: such a host keeps its members itself.
  const preferencesOnly = !offersUserAccounts && !offersGdpr;

  // Member-id lookup pulled BEFORE the early-return below so the hook
  // call order is stable across renders (react-hooks/rules-of-hooks).
  // ``user`` may be null when unauthenticated — the destructure stays
  // safe via optional chaining, and ``enabled`` gates the actual
  // network call.
  const memberIdRaw = (user as { member_id?: string | number | null } | null)
    ?.member_id;
  const memberIdForGate =
    isMemberOnly && memberIdRaw != null ? String(memberIdRaw) : null;
  // When the viewer is a member-only user whose Member row is NOT
  // yet ``admin_confirmed`` (pending office review) — or already
  // ``admin_rejected_at`` (refused) — we strip the menu down to a
  // single logout option. Same reasoning as the MemberDetail gate:
  // half-rendered profile / data / language items behind a portal
  // they can't use read as broken. One clear "log out" link beats
  // a dozen no-ops.
  //
  // Office / staff viewers always get the full menu, even when their
  // own linked Member is unconfirmed (shouldn't happen, but
  // defensive).
  const { data: ownMember } = useCommissioningMembersRetrieve(
    memberIdForGate ?? "",
    { query: { enabled: !!memberIdForGate && !preferencesOnly } },
  );

  if (!isAuthenticated) {
    return (
      <Button type="primary" onClick={() => navigate("/login")}>
        {t("auth.login")}
      </Button>
    );
  }

  if (preferencesOnly) {
    return <PreferenceButtons />;
  }

  const currentUser = user as MenuUser | null;

  const displayName = displayNameOf(currentUser);
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join("") || <UserOutlined />;
  const memberId = currentUser?.member_id;

  const openProfile = (tab: UserProfileTab) => {
    setProfileTab(tab);
    setProfileOpen(true);
  };

  const gateMenu = (() => {
    if (!isMemberOnly || !ownMember) return false;
    return !ownMember.admin_confirmed || !!ownMember.admin_rejected_at;
  })();

  // Without jasmin's own logins the host application owns the session, so
  // there is no profile, two-factor or logout here to offer.
  const logoutGroup: MenuItem[] = offersUserAccounts
    ? [
        {
          key: "logout",
          icon: <LogoutOutlined />,
          label: t("common.logout"),
          onClick: logout,
          danger: true,
        },
      ]
    : [];

  const preferencesGroup: MenuItem[] = [
    ...(offersUserAccounts
      ? [
          {
            key: "profile",
            icon: <UserOutlined />,
            label: t("profile.title"),
            onClick: () => openProfile("profile"),
          },
        ]
      : []),
    {
      key: "language",
      icon: <GlobalOutlined />,
      label: t("profile.menu_language"),
      children: languageItems,
    },
    {
      key: "theme",
      icon: <BgColorsOutlined />,
      label: t("profile.menu_theme"),
      children: themeItems,
    },
    ...(isStaff && hasMemberRole && memberId
      ? [
          {
            key: "member-page",
            icon: <IdcardOutlined />,
            label: t("profile.my_member_page"),
            onClick: () => navigate(`/members/members/${memberId}`),
          },
        ]
      : []),
  ];

  const accountGroup: MenuItem[] = [
    ...(offersGdpr
      ? [
          {
            key: "my-data",
            icon: <SafetyOutlined />,
            label: t("profile.tab_my_data"),
            onClick: () => openProfile("my_data"),
          },
        ]
      : []),
    ...(offersUserAccounts
      ? [
          {
            key: "two-factor",
            icon: <LockOutlined />,
            label: t("profile.tab_two_factor"),
            onClick: () => openProfile("two_factor"),
          },
        ]
      : []),
  ];

  // The gated menu is the way out; where the host application owns the
  // session there is none, so it keeps the preferences rather than open empty.
  const gatedItems = offersUserAccounts ? logoutGroup : preferencesGroup;
  const items: MenuProps["items"] = gateMenu
    ? gatedItems
    : joinWithDividers([preferencesGroup, accountGroup, logoutGroup]);

  return (
    <>
      <Dropdown menu={{ items }} placement="bottomLeft" trigger={["click"]}>
        <Button
          type="text"
          className="user-menu-button"
          aria-label={t("profile.menu_aria")}
        >
          <Space>
            <Avatar size="small" className="user-menu-avatar">
              {initials}
            </Avatar>
            {!isMobile && (
              <>
                <span>{displayName}</span>
                <DownOutlined className="user-menu-button__caret" />
              </>
            )}
          </Space>
        </Button>
      </Dropdown>
      <UserProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        initialTab={profileTab}
      />
    </>
  );
}
