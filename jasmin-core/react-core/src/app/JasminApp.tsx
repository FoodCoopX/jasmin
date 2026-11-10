import { ConfigProvider, Layout, theme } from "antd";
import { lazy, Suspense, useEffect, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { activateLanguage } from "@shared/i18n";
import { RequireCapability } from "@shared/auth/RequireCapability";
import { ROLES } from "@shared/auth/roles";
import { Navigate, Route, Routes, useMatch } from "react-router-dom";
import DynamicSidebar from "@shared/layout/DynamicSidebar";
import Footer from "@shared/layout/Footer";
import MainContent from "@shared/layout/MainContent";
import SkipToMainLink from "@shared/layout/SkipToMainLink";
import TopNavigation from "@shared/layout/TopNavigation";
import UserMenu from "@shared/layout/UserMenu";
import ErrorBoundary from "@shared/ui/ErrorBoundary";
import { useAuth } from "@shared/contexts/AuthContext";
import { useLocale } from "@shared/contexts/LocaleContext";
import { ModalProvider } from "@shared/contexts/ModalContext";
import { NavigationProvider } from "@shared/contexts/NavigationContext";
import { useErrorDateFormat, useTheme } from "@hooks/index";
import HostSignInPage from "@features/auth/pages/HostSignInPage";
import LoginPage from "@features/auth/pages/LoginPage";
import RegistrationPage from "@features/auth/pages/registration/RegistrationPage";
import SetPasswordPage from "@features/auth/pages/SetPasswordPage";
import ForgotPasswordPage from "@features/auth/pages/ForgotPasswordPage";
import ResetPasswordPage from "@features/auth/pages/ResetPasswordPage";
import DeletionConfirmPage from "@features/public/pages/DeletionConfirmPage";
import PrivacyPolicyPage from "@features/public/pages/PrivacyPolicyPage";
import PublicLegalNoticePage from "@features/public/pages/PublicLegalNoticePage";
import WaitingListOfferPage from "@features/public/pages/WaitingListOfferPage";

const MemberDetail = lazy(() => import("@features/members/pages/MemberDetail"));
const CustomerOrderPage = lazy(
  () => import("@features/customer/pages/CustomerOrderPage"),
);

import deDE from "antd/locale/de_DE";
import enUS from "antd/locale/en_US";
import itIT from "antd/locale/it_IT";
import frFR from "antd/locale/fr_FR";

const ANTD_LOCALES = { en: enUS, de: deDE, it: itIT, fr: frFR };

/** A page of jasmin's own logins. Where the host application signs people in,
 * it sends them to the sign-in page, which hands over to the host. */
function OwnAccountPage({ page }: { page: ReactNode }) {
  return (
    <RequireCapability
      name="user_accounts"
      fallback={<Navigate to="/login" replace />}
    >
      {page}
    </RequireCapability>
  );
}

export default function JasminApp() {
  const themeTokens = useTheme();
  const { language, theme: userTheme } = useLocale();
  const { user, isAuthenticated, bootstrapping } = useAuth();
  const { t, i18n } = useTranslation();
  useErrorDateFormat();
  // Pages a link in an email opens. The token in the URL is the credential, so
  // they open whatever the visitor's session: the layouts for signed-in users
  // would send a member or an office user to their own start page instead,
  // and the link would be lost.
  const deletionConfirmation = useMatch("/gdpr/confirm-deletion/:token");
  const waitingListOffer = useMatch("/waiting-list-offer/:token");

  const { defaultAlgorithm, darkAlgorithm } = theme;

  // Keyed on i18next's language rather than the context's, so AntD's chrome
  // turns over in the same paint as the translated text. The context flips as
  // soon as the profile PATCH resolves, which is one fetch earlier.
  const antdLocale = useMemo(
    () => ANTD_LOCALES[i18n.language as keyof typeof ANTD_LOCALES] || enUS,
    [i18n.language],
  );

  const isDark = userTheme === "dark";
  const antdTheme = {
    algorithm: isDark ? darkAlgorithm : defaultAlgorithm,
    token: {
      ...themeTokens,
      fontFamily:
        "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
    },
  };

  useEffect(() => {
    if (language) void activateLanguage(language);
  }, [language]);

  if (deletionConfirmation || waitingListOffer) {
    return (
      <ConfigProvider theme={antdTheme} locale={antdLocale}>
        <Routes>
          <Route
            path="/gdpr/confirm-deletion/:token"
            element={<DeletionConfirmPage />}
          />
          <Route
            path="/waiting-list-offer/:token"
            element={<WaitingListOfferPage />}
          />
        </Routes>
      </ConfigProvider>
    );
  }

  // Show the full-screen loader ONLY during the initial auth boot. Gating on
  // the per-action ``loading`` would unmount the login page on every submit and
  // drop the 2FA step (the credentials form would reappear instead of the code
  // field).
  if (bootstrapping) {
    return (
      <ConfigProvider theme={antdTheme} locale={antdLocale}>
        <div role="status" aria-live="polite" className="flex-center h-screen">
          {t("app.loading")}
        </div>
      </ConfigProvider>
    );
  }

  // If not authenticated, show login page WITHOUT layout
  if (!isAuthenticated) {
    return (
      <ConfigProvider theme={antdTheme} locale={antdLocale}>
        <Routes>
          <Route
            path="/login"
            element={
              <RequireCapability
                name="user_accounts"
                fallback={<HostSignInPage />}
              >
                <LoginPage />
              </RequireCapability>
            }
          />
          <Route
            path="/register"
            element={<OwnAccountPage page={<RegistrationPage />} />}
          />
          <Route
            path="/set-password/:token"
            element={<OwnAccountPage page={<SetPasswordPage />} />}
          />
          <Route
            path="/forgot-password"
            element={<OwnAccountPage page={<ForgotPasswordPage />} />}
          />
          <Route
            path="/reset-password/:uid/:token"
            element={<OwnAccountPage page={<ResetPasswordPage />} />}
          />
          <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="/impressum" element={<PublicLegalNoticePage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </ConfigProvider>
    );
  }

  const hasOnlyRole = (role: string) =>
    user?.roles?.length === 1 && user.roles[0] === role;

  // Derived from the canonical list rather than spelled out, so a role added
  // there is recognised here and a name that is not a role cannot be tested
  // for.
  const validRoles: string[] = Object.values(ROLES);
  const hasAnyValidRole = (user?.roles ?? []).some((role) =>
    validRoles.includes(role),
  );

  if (!hasAnyValidRole) {
    return (
      <ConfigProvider theme={antdTheme} locale={antdLocale}>
        <Navigate to="/login" replace />
      </ConfigProvider>
    );
  }

  // Member-only users get a minimal layout with just their member
  // page — plus a slim header carrying the unified ``<UserMenu />`` in
  // the top-right so the same login/data/GDPR/language bundle is
  // available across every role's layout.
  if (hasOnlyRole("member")) {
    const memberId = user?.member_id;
    const memberPath = memberId ? `/members/members/${memberId}` : "/login";
    return (
      <ConfigProvider theme={antdTheme} locale={antdLocale}>
        <Layout className="min-h-screen">
          <Layout.Header className="flex-end role-layout-header">
            <UserMenu />
          </Layout.Header>
          <Layout.Content className="role-layout-content">
            <ErrorBoundary>
              <Suspense
                fallback={
                  <div role="status" aria-live="polite">
                    {t("app.loading")}
                  </div>
                }
              >
                <Routes>
                  <Route
                    path="/members/members/:id"
                    element={<MemberDetail />}
                  />
                  <Route
                    path="*"
                    element={<Navigate to={memberPath} replace />}
                  />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </Layout.Content>
        </Layout>
      </ConfigProvider>
    );
  }

  // Customer-only users get a minimal layout with their order page —
  // same header treatment as the member layout above so the
  // ``<UserMenu />`` bundle is in the same place.
  if (hasOnlyRole("customer")) {
    return (
      <ConfigProvider theme={antdTheme} locale={antdLocale}>
        <Layout className="min-h-screen">
          <Layout.Header className="flex-end role-layout-header">
            <UserMenu />
          </Layout.Header>
          <Layout.Content className="role-layout-content">
            <ErrorBoundary>
              <Suspense
                fallback={
                  <div role="status" aria-live="polite">
                    {t("app.loading")}
                  </div>
                }
              >
                <Routes>
                  <Route path="/customer" element={<CustomerOrderPage />} />
                  <Route
                    path="*"
                    element={<Navigate to="/customer" replace />}
                  />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </Layout.Content>
        </Layout>
      </ConfigProvider>
    );
  }

  // Render full app with layout for authenticated staff users
  return (
    <ConfigProvider theme={antdTheme} locale={antdLocale}>
      <NavigationProvider>
        <ModalProvider>
          <Layout className="min-h-screen">
            <SkipToMainLink />
            <TopNavigation />
            <Layout>
              <DynamicSidebar />
              <MainContent />
            </Layout>
            <Footer />
          </Layout>
        </ModalProvider>
      </NavigationProvider>
    </ConfigProvider>
  );
}
