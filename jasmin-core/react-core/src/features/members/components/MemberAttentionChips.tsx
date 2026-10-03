import { Badge, Button, Space } from "antd";
import { useTranslation } from "react-i18next";

import type { MemberAttention } from "@features/members/hooks/useMemberAttentionFilter";
import { ToolTipIcon } from "@shared/ui";

interface MemberAttentionChipsProps {
  attention: MemberAttention | null;
  counts: Record<MemberAttention, number>;
  onToggle: (chip: MemberAttention) => void;
  /** The coop-share chip only shows for tenants with coop shares. */
  showCoopShares: boolean;
}

/**
 * The members list's "needs attention" chips, each with the number of
 * members it keeps. Only chips with a member to show appear; clicking one
 * filters the list to its members, clicking it again shows everyone.
 */
export default function MemberAttentionChips({
  attention,
  counts,
  onToggle,
  showCoopShares,
}: MemberAttentionChipsProps) {
  const { t } = useTranslation();
  const chips: { key: MemberAttention; label: string; color?: string }[] = [
    { key: "members", label: t("members.attention_chip_members") },
    ...(showCoopShares
      ? [
          {
            key: "coop" as const,
            label: t("members.attention_chip_coop"),
            color: "gold",
          },
        ]
      : []),
    {
      key: "consent",
      label: t("members.attention_chip_consent"),
      color: "orange",
    },
  ];
  const shown = chips.filter((chip) => counts[chip.key] > 0);
  if (shown.length === 0) return null;

  return (
    <Space className="members-attention-chips" size="large" wrap>
      {shown.map((chip) => (
        <Badge
          key={chip.key}
          count={counts[chip.key]}
          size="small"
          color={chip.color}
        >
          <Button
            size="small"
            type={attention === chip.key ? "primary" : "default"}
            onClick={() => onToggle(chip.key)}
          >
            {chip.label}
          </Button>
        </Badge>
      ))}
      <ToolTipIcon title={t("tooltip.open_members")} />
    </Space>
  );
}
