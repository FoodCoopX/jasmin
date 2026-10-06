import type { ReactNode } from "react";
import { Card } from "antd";

/** The frame of a page a link in an email opens: the tenant's logo over one
 *  centred card, without the app's navigation. */
export default function PublicCard({
  logoUrl,
  children,
}: {
  logoUrl?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="public-card-page">
      <Card className="public-card">
        {logoUrl ? (
          <div className="public-card-logo">
            <img src={logoUrl} alt="" />
          </div>
        ) : null}
        {children}
      </Card>
    </div>
  );
}
