/**
 * UserMenu: picking a language or a theme, from the menu or, where a host
 * application owns the logins, from the two buttons that stand in for it.
 * LocaleContext shows a failed save to the user and rethrows, so the menu must
 * take up the rejection rather than leave it unhandled, which Vitest reports
 * as an error of the run. The locale context is the mocking boundary.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// Plain functions, not ``vi.fn``: a mock subscribes to the promise it
// returns, which would take up the very rejection under test.
const { saves } = vi.hoisted(() => ({ saves: [] as string[] }));
const refuse = (picked: string) => {
  saves.push(picked);
  return Promise.reject(new Error("Network Error"));
};

vi.mock("@shared/contexts/LocaleContext", () => ({
  useLocale: () => ({
    language: "de",
    saveLanguage: refuse,
    themePreference: "system",
    saveThemePreference: refuse,
  }),
}));
vi.mock("@shared/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", first_name: "Ada", email: "ada@example.com" },
    isAuthenticated: true,
    logout: vi.fn(),
  }),
}));
// An office user by default; a member awaiting confirmation gets the gated menu.
const viewer = vi.hoisted(() => ({
  isMemberOnly: false,
  ownMember: undefined as { admin_confirmed: boolean } | undefined,
}));
vi.mock("@shared/auth/useRoles", () => ({
  useRoles: () => ({
    hasMemberRole: viewer.isMemberOnly,
    isStaff: !viewer.isMemberOnly,
    isMemberOnly: viewer.isMemberOnly,
  }),
}));
vi.mock("@shared/api/generated/commissioning/commissioning", () => ({
  useCommissioningMembersRetrieve: () => ({ data: viewer.ownMember }),
}));
// What the deployment offers; a name left out is offered, as with a payload
// that carries no capabilities.
const capabilities = vi.hoisted(() => ({}) as Record<string, boolean>);
vi.mock("@hooks/index", () => ({
  useIsMobile: () => false,
  useCapability: (name: string) => capabilities[name] ?? true,
}));
vi.mock("../UserProfileModal", () => ({ default: () => null }));

import UserMenu from "../UserMenu";

beforeEach(() => {
  saves.length = 0;
  for (const name of Object.keys(capabilities)) delete capabilities[name];
  viewer.isMemberOnly = false;
  viewer.ownMember = undefined;
});

async function openMenu() {
  render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole("button", { name: "profile.menu_aria" }));
  await screen.findByText("profile.menu_language");
}

const accountEntries = [
  "profile.title",
  "profile.tab_my_data",
  "profile.tab_two_factor",
  "common.logout",
];

async function pick(submenu: string, item: string) {
  render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole("button", { name: "profile.menu_aria" }));
  fireEvent.mouseEnter(await screen.findByText(submenu));
  await userEvent.click(await screen.findByText(item));
}

describe("UserMenu preferences", () => {
  it("catches a language save the context refused", async () => {
    await pick("profile.menu_language", "English");

    await waitFor(() => expect(saves).toEqual(["en"]));
  });

  it("catches a theme save the context refused", async () => {
    await pick("profile.menu_theme", "profile.theme_dark");

    await waitFor(() => expect(saves).toEqual(["dark"]));
  });
});

describe("UserMenu account entries", () => {
  it("offers the profile, my data, two-factor and logout on its own", async () => {
    await openMenu();

    for (const entry of accountEntries) {
      expect(screen.getByText(entry)).toBeInTheDocument();
    }
  });


  it("gives a member awaiting confirmation only the logout", async () => {
    viewer.isMemberOnly = true;
    viewer.ownMember = { admin_confirmed: false };
    render(
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "profile.menu_aria" }));

    expect(await screen.findByText("common.logout")).toBeInTheDocument();
    expect(screen.queryByText("profile.menu_language")).not.toBeInTheDocument();
  });


  it("keeps the menu for my data where a host owns the logins but not the data protection", async () => {
    capabilities.user_accounts = false;
    await openMenu();

    expect(screen.getByText("profile.tab_my_data")).toBeInTheDocument();
    for (const entry of ["profile.title", "profile.tab_two_factor", "common.logout"]) {
      expect(screen.queryByText(entry)).not.toBeInTheDocument();
    }
  });

  it("gives a member awaiting confirmation the preferences, not an empty menu, where the host owns the session", async () => {
    viewer.isMemberOnly = true;
    viewer.ownMember = { admin_confirmed: false };
    capabilities.user_accounts = false;
    await openMenu();

    expect(screen.getByText("profile.menu_theme")).toBeInTheDocument();
    expect(screen.queryByText("common.logout")).not.toBeInTheDocument();
  });

  it("drops only my data where the deployment has no data-protection actions", async () => {
    capabilities.gdpr = false;
    await openMenu();

    expect(screen.queryByText("profile.tab_my_data")).not.toBeInTheDocument();
    expect(screen.getByText("profile.tab_two_factor")).toBeInTheDocument();
    expect(screen.getByText("common.logout")).toBeInTheDocument();
  });
});

describe("UserMenu inside a host that owns the logins and the data protection", () => {
  beforeEach(() => {
    capabilities.user_accounts = false;
    capabilities.gdpr = false;
  });

  const renderInHost = () =>
    render(
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>,
    );

  it("shows the language and the theme as two buttons instead of the menu", () => {
    renderInHost();

    expect(screen.queryByRole("button", { name: "profile.menu_aria" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "profile.menu_language" })).toBeInTheDocument();
    // The theme button shows the theme picked: the device's.
    const themeButton = screen.getByRole("button", { name: "profile.menu_theme" });
    expect(within(themeButton).getByRole("img", { name: "desktop" })).toBeInTheDocument();
  });

  it("catches a language save the context refused", async () => {
    renderInHost();
    await userEvent.click(screen.getByRole("button", { name: "profile.menu_language" }));
    await userEvent.click(await screen.findByText("English"));

    await waitFor(() => expect(saves).toEqual(["en"]));
  });

  it("catches a theme save the context refused", async () => {
    renderInHost();
    await userEvent.click(screen.getByRole("button", { name: "profile.menu_theme" }));
    await userEvent.click(await screen.findByText("profile.theme_dark"));

    await waitFor(() => expect(saves).toEqual(["dark"]));
  });

  it("shows the buttons, not the logout-only menu, to a member awaiting confirmation", () => {
    viewer.isMemberOnly = true;
    viewer.ownMember = { admin_confirmed: false };
    renderInHost();

    expect(screen.getByRole("button", { name: "profile.menu_theme" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "profile.menu_aria" })).not.toBeInTheDocument();
  });

  it("drops the staff's link to their member page with the menu", () => {
    renderInHost();

    expect(screen.queryByText("profile.my_member_page")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "profile.menu_aria" })).not.toBeInTheDocument();
  });
});
