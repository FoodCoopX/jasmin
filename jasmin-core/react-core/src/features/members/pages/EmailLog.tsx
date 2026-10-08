import { Input, Select } from "antd";
import { ReadOnlyReportTable } from "@shared/tables";
import { ExplainerText } from "@shared/ui";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  EmailLog,
  NotificationsEmailLogsListParams,
  NotificationsEmailLogsListStatus,
} from "@shared/api/generated/models";
import {
  useNotificationsEmailLogsList,
  useNotificationsEmailLogsPurposes,
} from "@shared/api/generated/notifications/notifications";
import { useTimeFormat } from "@hooks/index";
import EmailStatusTag from "../components/EmailStatusTag";
import { useEmailPurposeLabel } from "../hooks/useEmailPurposeLabel";

// The API closes this set: typing the list against the generated enum keeps a
// status the server no longer accepts from lingering in the filter.
const ALL_STATUSES: readonly NotificationsEmailLogsListStatus[] = [
  "pending",
  "sent",
  "failed",
  "suppressed",
  "rate_limited",
] as const;

export default function EmailLog() {
  const { t } = useTranslation();
  const { formatDateTime } = useTimeFormat();
  const purposeLabel = useEmailPurposeLabel();

  const [recipientFilter, setRecipientFilter] = useState("");
  const [purposeFilter, setPurposeFilter] = useState<string | undefined>(
    undefined,
  );
  const [statusFilter, setStatusFilter] = useState<
    NotificationsEmailLogsListStatus | undefined
  >(undefined);

  const params = useMemo<NotificationsEmailLogsListParams>(() => {
    const p: NotificationsEmailLogsListParams = {};
    if (recipientFilter.trim()) p.recipient = recipientFilter.trim();
    if (purposeFilter) p.purpose = purposeFilter;
    if (statusFilter) p.status = statusFilter;
    return p;
  }, [recipientFilter, purposeFilter, statusFilter]);

  // ``isFetching`` (not ``isLoading``): filter changes alter the query key,
  // and with the global ``staleTime: 0`` a revisited filter combination is
  // cached (``isLoading === false``) — only ``isFetching`` shows the spinner
  // while the refetch runs, instead of silently displaying stale rows.
  const { data, isFetching } = useNotificationsEmailLogsList(params);

  const rows = useMemo<EmailLog[]>(
    () => (Array.isArray(data) ? data : []),
    [data],
  );

  // The purposes the log holds: most sends log their template slug, some a
  // purpose of their own (``invoice:reseller``, ``test:smtp``, …).
  const { data: loggedPurposes } = useNotificationsEmailLogsPurposes();
  const purposeOptions = useMemo(
    () =>
      (loggedPurposes?.purposes ?? [])
        .map((purpose) => ({ value: purpose, label: purposeLabel(purpose) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [loggedPurposes, purposeLabel],
  );

  const columns = useMemo<ColumnsType<EmailLog>>(
    () => [
      {
        title: t("logging.created"),
        dataIndex: "created_at",
        key: "created_at",
        width: "11em",
        defaultSortOrder: "descend",
        sorter: (a, b) =>
          (a.created_at ?? "").localeCompare(b.created_at ?? ""),
        render: (value: string) => formatDateTime(value),
      },
      {
        title: t("email_matrix.recipient"),
        dataIndex: "recipient",
        key: "recipient",
        ellipsis: true,
      },
      {
        title: t("email_matrix.subject"),
        dataIndex: "subject",
        key: "subject",
        ellipsis: true,
      },
      {
        title: t("email_matrix.purpose"),
        dataIndex: "purpose",
        key: "purpose",
        render: (value: string) => purposeLabel(value),
      },
      {
        title: t("email_matrix.status_col"),
        dataIndex: "status",
        key: "status",
        width: "9em",
        render: (value: string) => <EmailStatusTag status={value} />,
      },
      {
        title: t("email_matrix.sent_at"),
        dataIndex: "sent_at",
        key: "sent_at",
        width: "11em",
        render: (value: string | null) => (value ? formatDateTime(value) : "—"),
      },
    ],
    [t, formatDateTime, purposeLabel],
  );

  return (
    <div>
      <h1>{t("members.title_email_log")}</h1>
      <div className="filter-bar" style={{ marginBottom: "2em" }}>
        <Input
          placeholder={t("email_matrix.recipient")}
          aria-label={t("email_matrix.recipient")}
          value={recipientFilter}
          onChange={(e) => setRecipientFilter(e.target.value)}
          allowClear
          style={{ width: 220 }}
        />
        <Select
          placeholder={t("email_matrix.purpose")}
          aria-label={t("email_matrix.purpose")}
          value={purposeFilter}
          onChange={setPurposeFilter}
          allowClear
          style={{ width: 220 }}
          options={purposeOptions}
        />
        <Select
          placeholder={t("email_matrix.status_col")}
          aria-label={t("email_matrix.status_col")}
          value={statusFilter}
          onChange={setStatusFilter}
          allowClear
          style={{ width: 160 }}
          options={ALL_STATUSES.map((s) => ({
            value: s,
            label: t(`email_matrix.status.${s}`),
          }))}
        />
      </div>

      <ReadOnlyReportTable<EmailLog>
        columns={columns}
        dataSource={rows}
        rowKey="id"
        loading={isFetching}
        pagination={{ pageSize: 50, showSizeChanger: true }}
        emptyText={t("members.no_emails_sent")}
      />

      <ExplainerText title={t("common.info")}>
        {t("explainers.email_log")}
      </ExplainerText>
    </div>
  );
}
