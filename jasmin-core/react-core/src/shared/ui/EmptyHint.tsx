import { Typography } from "antd";
import type { ReactNode } from "react";

const { Text } = Typography;

interface EmptyHintProps {
  /** Already-translated placeholder message. */
  children: ReactNode;
  /** Taller, for the space a chart would fill. */
  chart?: boolean;
}

/**
 * Subtle "no data" placeholder — a small, centered, muted line of text.
 * Deliberately icon-less: the replacement for AntD's `<Empty>`, whose large
 * illustration is too heavy for inline "nothing here yet" states.
 */
export default function EmptyHint({ children, chart = false }: EmptyHintProps) {
  return (
    <div className={chart ? "empty-hint empty-hint--chart" : "empty-hint"}>
      <Text type="secondary">{children}</Text>
    </div>
  );
}
