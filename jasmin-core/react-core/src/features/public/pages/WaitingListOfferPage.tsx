import { useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Button,
  Descriptions,
  Result,
  Space,
  Spin,
  Typography,
} from "antd";
import {
  commissioningWaitingListOffersAcceptCreate,
  commissioningWaitingListOffersDeclineCreate,
  useCommissioningWaitingListOffersRetrieve,
} from "@shared/api/generated/commissioning/commissioning";
import { getErrorCode } from "@shared/utils/apiError";
import {
  useCurrency,
  useDateFormat,
  useShareTypeVariationSizeOptions,
  useTenant,
} from "@hooks/index";
import PublicCard from "../components/PublicCard";

const { Title, Paragraph } = Typography;

type Outcome = "pending" | "accepted" | "declined" | "expired" | "error";

/**
 * Public (no-login) magic-link page: a waiting-list member accepts or declines
 * the freed-spot offer the office sent them. The ``:token`` in the URL is the
 * credential — the API endpoints are ``AllowAny`` and single-use.
 */
export default function WaitingListOfferPage() {
  const { t } = useTranslation();
  const { token = "" } = useParams<{ token: string }>();
  const { formatDate } = useDateFormat();
  const { currencySymbol } = useCurrency();
  const { logoUrl } = useTenant();
  const { getShareTypeVariationSizeLabel } = useShareTypeVariationSizeOptions();
  const { data, isLoading, isError } = useCommissioningWaitingListOffersRetrieve(
    token,
    { query: { retry: false, enabled: !!token } },
  );
  const [outcome, setOutcome] = useState<Outcome>("pending");
  const [submitting, setSubmitting] = useState(false);

  const onAccept = async () => {
    setSubmitting(true);
    try {
      await commissioningWaitingListOffersAcceptCreate(token);
      setOutcome("accepted");
    } catch (error) {
      setOutcome(
        getErrorCode(error) === "waiting_list_offer.expired" ? "expired" : "error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const onDecline = async () => {
    setSubmitting(true);
    try {
      await commissioningWaitingListOffersDeclineCreate(token);
      setOutcome("declined");
    } catch {
      setOutcome("error");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <PublicCard logoUrl={logoUrl}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <Spin />
        </div>
      </PublicCard>
    );
  }

  if (isError || !data) {
    return (
      <PublicCard logoUrl={logoUrl}>
        <Result
          status="warning"
          title={t("abos.offer_page.invalid_title")}
          subTitle={t("abos.offer_page.invalid_text")}
        />
      </PublicCard>
    );
  }

  if (outcome === "accepted") {
    return (
      <PublicCard logoUrl={logoUrl}>
        <Result
          status="success"
          title={t("abos.offer_page.accepted_title")}
          subTitle={t("abos.offer_page.accepted_text")}
        />
      </PublicCard>
    );
  }
  if (outcome === "declined") {
    return (
      <PublicCard logoUrl={logoUrl}>
        <Result
          status="info"
          title={t("abos.offer_page.declined_title")}
          subTitle={t("abos.offer_page.declined_text")}
        />
      </PublicCard>
    );
  }
  if (outcome === "expired" || data.expired) {
    return (
      <PublicCard logoUrl={logoUrl}>
        <Result
          status="warning"
          title={t("abos.offer_page.expired_title")}
          subTitle={t("abos.offer_page.expired_text")}
        />
      </PublicCard>
    );
  }
  if (outcome === "error") {
    return (
      <PublicCard logoUrl={logoUrl}>
        <Result
          status="error"
          title={t("abos.offer_page.error_title")}
          subTitle={t("abos.offer_page.error_text")}
        />
      </PublicCard>
    );
  }

  // "<qty> × <share type> <localized size>" — composed here (not from the
  // backend's share_type_variation_string, which bakes in the untranslated
  // size so getShareTypeVariationSizeLabel can't localize it).
  const sizeLabel = data.variation_size
    ? getShareTypeVariationSizeLabel(data.variation_size)
    : "";
  const namePlusSize = [data.variation_name, sizeLabel]
    .filter(Boolean)
    .join(" ");
  const shareLabel = namePlusSize
    ? data.quantity
      ? `${data.quantity} × ${namePlusSize}`
      : namePlusSize
    : "";

  return (
    <PublicCard logoUrl={logoUrl}>
      <Title level={4}>
        {t("abos.offer_page.title", { name: data.member_first_name })}
      </Title>
      <Paragraph>{t("abos.offer_page.intro")}</Paragraph>
      <Descriptions column={1} size="small" bordered>
        {shareLabel ? (
          <Descriptions.Item label={t("abos.offer_page.share")}>
            {shareLabel}
          </Descriptions.Item>
        ) : null}
        {data.delivery_station_name ? (
          <Descriptions.Item label={t("abos.offer_page.station")}>
            {data.delivery_station_name}
            {data.delivery_station_address ? (
              <div
                style={{
                  color: "var(--color-text-tertiary)",
                  fontSize: "0.9em",
                }}
              >
                {data.delivery_station_address}
              </div>
            ) : null}
          </Descriptions.Item>
        ) : null}
        {data.valid_from ? (
          <Descriptions.Item label={t("abos.offer_page.start")}>
            {formatDate(data.valid_from)}
          </Descriptions.Item>
        ) : null}
        {data.valid_until ? (
          <Descriptions.Item label={t("abos.offer_page.end")}>
            {formatDate(data.valid_until)}
          </Descriptions.Item>
        ) : null}
        {data.price_per_delivery ? (
          <Descriptions.Item label={t("abos.offer_page.price")}>
            {currencySymbol} {data.price_per_delivery}
          </Descriptions.Item>
        ) : null}

        {data.expires_at ? (
          <Descriptions.Item label={t("abos.offer_page.reply_by")}>
            {formatDate(data.expires_at)}
          </Descriptions.Item>
        ) : null}
      </Descriptions>
      <Space
        style={{ marginTop: 24, width: "100%", justifyContent: "flex-end" }}
      >
        <Button danger onClick={onDecline} loading={submitting}>
          {t("abos.offer_page.decline")}
        </Button>
        <Button type="primary" onClick={onAccept} loading={submitting}>
          {t("abos.offer_page.accept")}
        </Button>
      </Space>
    </PublicCard>
  );
}
