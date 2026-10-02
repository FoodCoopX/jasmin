import { Avatar } from "antd";
import { useTranslation } from "react-i18next";

import { useTenant } from "@hooks/index";
import type { LogoShape } from "@shared/hooks/useLogoShape";

import "./TenantHeaderLogo.css";

// The short side of a rectangular logo, in pixels.
const LOGO_SIZE = 120;

interface TenantHeaderLogoProps {
  logoUrl: string | null | undefined;
  /**
   * From `useLogoShape(logoUrl)`. The caller runs the hook so it can start
   * measuring the logo before the header first renders.
   */
  logoShape: LogoShape;
  logoAspectRatio: number;
}

/**
 * The tenant's logo at the start of a page's header card: a box sized to the
 * logo's aspect ratio when it is clearly wide or tall, a round avatar
 * otherwise. Renders nothing without a logo.
 */
export default function TenantHeaderLogo({
  logoUrl,
  logoShape,
  logoAspectRatio,
}: TenantHeaderLogoProps) {
  const { t } = useTranslation();
  const { tenantName } = useTenant();

  if (!logoUrl) return null;
  const alt = tenantName ?? t("common.logo");

  if (logoShape === "rectangle-wide" || logoShape === "rectangle-tall") {
    const wide = logoShape === "rectangle-wide";
    return (
      <div
        className="tenant-header-logo"
        style={{
          width: `${wide ? LOGO_SIZE * logoAspectRatio : LOGO_SIZE}px`,
          height: `${wide ? LOGO_SIZE : LOGO_SIZE / logoAspectRatio}px`,
        }}
      >
        <img src={logoUrl} alt={alt} className="tenant-header-logo__image" />
      </div>
    );
  }

  return (
    <Avatar
      size={64}
      src={logoUrl}
      shape="circle"
      alt={alt}
      className="tenant-header-logo__avatar"
    />
  );
}
