import { MailOutlined, PhoneOutlined } from "@ant-design/icons";
import { Card, Col, Row, Space, Typography } from "antd";
import type { Reseller } from "@shared/api/generated/models";
import { useAuth } from "@shared/contexts/AuthContext";
import { useLogoShape } from "@hooks/index";
import { TenantHeaderLogo } from "@shared/ui";

const { Title, Text } = Typography;

interface Props {
  reseller: Reseller | undefined;
  logoUrl: string | null | undefined;
}

/**
 * Customer-page header card. Mirrors ``MemberDetail``'s header: logo
 * on the left, "name + email + phone" in the middle.
 *
 * Falls back to the authenticated ``JasminUser`` fields when the linked
 * ``ContactEntity`` hasn't been filled in yet (true for seed-fixture
 * customers and self-service onboardings that go through
 * ``MyCustomerDataView`` lazy provisioning). Editing happens
 * exclusively in the top-right ``UserMenu`` → "Meine Daten" — no
 * page-local edit button.
 */
export default function CustomerOrderHeader({ reseller, logoUrl }: Props) {
  const { logoShape, logoAspectRatio } = useLogoShape(logoUrl);
  const { user } = useAuth();
  const currentUser = user as {
    first_name?: string;
    last_name?: string;
    email?: string;
  } | null;

  const displayName =
    reseller?.company_name ||
    [reseller?.first_name, reseller?.last_name].filter(Boolean).join(" ") ||
    [currentUser?.first_name, currentUser?.last_name]
      .filter(Boolean)
      .join(" ") ||
    currentUser?.email ||
    "";

  // The CUSTOMER's email — the reseller's own contact email, else its linked
  // user's. Never the logged-in user's (an office viewer must not see their own
  // email on a customer's page); no email at all when the customer has none.
  const linkedUserEmail = (
    reseller?.linked_user_info as { email?: string | null } | null | undefined
  )?.email;
  const displayEmail = reseller?.email || linkedUserEmail || undefined;
  const displayPhone = reseller?.phone;

  return (
    <Card
      style={{
        marginBottom: "24px",
        background: "var(--gradient-primary)",
        color: "var(--color-bg-base)",
      }}
      styles={{ body: { padding: "16px" } }}
    >
      <Row align="middle" gutter={24}>
        <Col>
          <TenantHeaderLogo
            logoUrl={logoUrl}
            logoShape={logoShape}
            logoAspectRatio={logoAspectRatio}
          />
        </Col>
        <Col flex="auto">
          <h1 style={{ color: "var(--color-bg-base)", marginBottom: "8px" }}>
            {displayName}
          </h1>
          <Space size="large">
            {displayEmail && (
              <Text style={{ color: "rgba(255,255,255,0.9)" }}>
                <MailOutlined /> {displayEmail}
              </Text>
            )}
            {displayPhone && (
              <Text style={{ color: "rgba(255,255,255,0.9)" }}>
                <PhoneOutlined /> {displayPhone}
              </Text>
            )}
          </Space>
        </Col>
      </Row>
    </Card>
  );
}
