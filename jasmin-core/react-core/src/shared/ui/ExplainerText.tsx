import type { CSSProperties, ReactNode } from "react";
import { Typography } from "antd";

const { Text } = Typography;

interface ExplainerTextProps {
  children: ReactNode;
  title?: string;
  style?: CSSProperties;
  maxWidth?: string;
  marginTop?: string;
}

/** A soft panel that explains a page or one of its sections. */
const ExplainerText = ({
  children,
  title,
  style = {},
  maxWidth = "40em",
  marginTop = "2em",
}: ExplainerTextProps) => (
  <div className="explainer-text" style={{ maxWidth, marginTop, ...style }}>
    <div className="explainer-text__header">
      <span aria-hidden="true" className="explainer-text__icon">
        💡
      </span>
      {title && (
        <Text strong className="explainer-text__title">
          {title}
        </Text>
      )}
    </div>
    <Text type="secondary" className="explainer-text__body">
      {children}
    </Text>
  </div>
);

export default ExplainerText;
