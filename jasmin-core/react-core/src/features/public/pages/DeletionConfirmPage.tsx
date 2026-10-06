import { Button, Result, Typography } from "antd";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useGdprConfirmDeletionCreate } from "@shared/api/generated/gdpr/gdpr";
import { getErrorMessage } from "@shared/utils/apiError";
import { useTenant } from "@hooks/index";
import PublicCard from "../components/PublicCard";

const { Title, Paragraph } = Typography;

/**
 * Opened from the deletion-confirmation email: the person confirms their
 * erasure request, which then goes to the office for review. The ``:token``
 * is the credential. Confirming takes a click rather than happening on load,
 * so a mail scanner that opens the link can't confirm the request.
 */
export default function DeletionConfirmPage() {
  const { t } = useTranslation();
  const { token = "" } = useParams<{ token: string }>();
  const { logoUrl } = useTenant();
  const confirmation = useGdprConfirmDeletionCreate();

  if (confirmation.isSuccess) {
    return (
      <PublicCard logoUrl={logoUrl}>
        <Result
          status="success"
          title={t("gdpr.confirm_page_confirmed_title")}
          subTitle={t("gdpr.confirm_page_confirmed_text")}
        />
      </PublicCard>
    );
  }

  if (confirmation.isError) {
    return (
      <PublicCard logoUrl={logoUrl}>
        <Result
          status="warning"
          title={t("gdpr.confirm_page_failed_title")}
          subTitle={getErrorMessage(
            confirmation.error,
            t("gdpr.confirm_page_failed_text"),
          )}
        />
      </PublicCard>
    );
  }

  return (
    <PublicCard logoUrl={logoUrl}>
      <Title level={4}>{t("gdpr.confirm_page_title")}</Title>
      <Paragraph>{t("gdpr.confirm_page_text")}</Paragraph>
      <Button
        type="primary"
        danger
        block
        loading={confirmation.isPending}
        onClick={() => confirmation.mutate({ token })}
      >
        {t("gdpr.confirm_page_button")}
      </Button>
    </PublicCard>
  );
}
