/**
 * The registration wizard opens in the language the app worked out for the
 * visitor and offers the language switcher beside it. The language the wizard
 * is filled in becomes the new member's ``user_language``, which the
 * set-password email and every email after it are written in, so a language
 * picked on the page is the one the account is registered with.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useEffect, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StepProps } from "../types";

const { i18nState, registerAccount } = vi.hoisted(() => ({
  i18nState: { language: "de", changeLanguage: () => Promise.resolve() },
  registerAccount: vi.fn((_request: unknown) => Promise.resolve({})),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: i18nState,
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@hooks/index", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock();
  return { useTenant: () => tenant };
});

vi.mock("@shared/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock("@shared/api/generated/auth/auth", () => ({
  authPartialUpdate: vi.fn(),
  useAuthRegisterSendCodeCreate: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useAuthRegisterVerifyCodeCreate: () => ({
    mutateAsync: () => Promise.resolve({}),
    isPending: false,
  }),
  useAuthRegisterCreate: () => ({
    mutateAsync: registerAccount,
    isPending: false,
  }),
}));

// The captcha widget renders nothing without a sitekey, and this tenant sets
// none.
vi.mock("@shared/auth/FriendlyCaptcha", () => ({
  FriendlyCaptcha: forwardRef(function FriendlyCaptcha() {
    return null;
  }),
}));

/** The steps before the email check, each only moving on; the details step
 * also hands over who is registering. */
vi.mock("../steps/StepCoopShares", () => ({
  default: ({ next }: StepProps) => <button onClick={next}>continue</button>,
}));
vi.mock("../steps/StepShareTypeVariation", () => ({
  default: ({ next }: StepProps) => <button onClick={next}>continue</button>,
}));
vi.mock("../steps/StepConsents", () => ({
  default: ({ next }: StepProps) => <button onClick={next}>continue</button>,
}));
vi.mock("../steps/StepYourDetails", () => ({
  default: ({ update, next }: StepProps) => (
    <button
      onClick={() => {
        update({
          first_name: "Ada",
          last_name: "Lovelace",
          email: "ada@example.com",
        });
        next();
      }}
    >
      continue
    </button>
  ),
}));
vi.mock("../steps/StepDone", () => ({ default: () => <p>registered</p> }));

import { LocaleProvider, useLocale } from "@shared/contexts/LocaleContext";
import { SUPPORTED_LANGUAGES } from "@shared/i18n/languages";
import RegistrationPage from "../RegistrationPage";

/** JasminApp's part: hand the language the app speaks to i18next, whose
 * ``i18n.language`` the email step registers the new member in. */
function LanguageBridge() {
  const { language } = useLocale();
  useEffect(() => {
    i18nState.language = language;
  }, [language]);
  return null;
}

function renderRegistration() {
  return render(
    <MemoryRouter initialEntries={["/register"]}>
      <LocaleProvider>
        <LanguageBridge />
        <RegistrationPage />
      </LocaleProvider>
    </MemoryRouter>,
  );
}

const languageOf = (code: string) =>
  SUPPORTED_LANGUAGES.find((language) => language.code === code)!;

const switcher = () =>
  screen.getByRole("combobox", { name: "common.language" });

/** Walk through the wizard to the email check and confirm the code there. */
async function registerThroughTheWizard(
  user: ReturnType<typeof userEvent.setup>,
) {
  for (let step = 0; step < 4; step += 1) {
    await user.click(screen.getByRole("button", { name: "continue" }));
  }
  await user.type(
    screen.getByLabelText("auth.registration.confirm.code_label"),
    "123456",
  );
  await user.click(
    screen.getByRole("button", { name: "auth.registration.confirm.submit" }),
  );
  await screen.findByText("registered");
}

/** The ``user_language`` the account was registered with. */
const registeredLanguage = () =>
  (registerAccount.mock.calls[0][0] as { data: { user_language: string } })
    .data.user_language;

describe("RegistrationPage language", () => {
  beforeEach(() => {
    localStorage.clear();
    i18nState.language = "de";
    registerAccount.mockClear();
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE", "de"]);
  });

  it("opens in the browser's language and offers the switcher", () => {
    renderRegistration();

    expect(switcher()).toHaveAccessibleDescription(languageOf("de").name);
  });

  it("registers the new member in the browser's language when none is picked", async () => {
    renderRegistration();

    await registerThroughTheWizard(userEvent.setup());

    await waitFor(() => expect(registerAccount).toHaveBeenCalledTimes(1));
    expect(registeredLanguage()).toBe("de");
  });

  it("registers the new member in the language picked on the page", async () => {
    renderRegistration();
    const user = userEvent.setup();

    await user.click(switcher());
    const list = await screen.findByRole("listbox");
    await user.click(
      within(list).getByRole("option", { name: languageOf("en").name }),
    );
    await waitFor(() =>
      expect(switcher()).toHaveAccessibleDescription(languageOf("en").name),
    );

    await registerThroughTheWizard(user);

    await waitFor(() => expect(registerAccount).toHaveBeenCalledTimes(1));
    expect(registeredLanguage()).toBe("en");
  });
});
