import { Alert } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useCommissioningSharesDeliveryDaysList } from "@shared/api/generated/commissioning/commissioning";
import type { SharesDeliveryDay } from "@shared/api/generated/models";
import { useRoles } from "@shared/auth";
import { useDateFormat, useWashingCleaningVisibility } from "@hooks/index";
import { todayApiDate } from "@shared/utils/apiDate";
import { WEEKDAY_KEYS } from "@shared/utils/weekdayNames";

// The work days a delivery day's shares take their harvest, packing, washing
// and cleaning from. The stock-count day computes nothing, so it isn't one.
const WORK_DAY_LABELS = {
  default_harvesting_day: "configuration.default_harvesting_day",
  default_packing_day: "configuration.default_packing_day",
  default_washing_day: "configuration.default_washing_day",
  default_cleaning_day: "configuration.default_cleaning_day",
} as const;

type WorkDayField = keyof typeof WORK_DAY_LABELS;

/** The label keys of the ``shownFields`` that ``day`` lacks. */
const missingWorkDays = (
  day: SharesDeliveryDay,
  shownFields: WorkDayField[],
): string[] =>
  shownFields
    .filter((field) => day[field] == null)
    .map((field) => WORK_DAY_LABELS[field]);

/**
 * Red banner over the commissioning pages while a delivery day running today
 * or later lacks a work day: its shares then drop out of the harvest list and
 * the theoretical stock, nothing is planned to be washed or cleaned, and
 * packing falls back to the delivery day. Delivery days a host syncs in arrive
 * without work days. A farm that hides washing or cleaning isn't asked for
 * those days.
 */
export default function MissingWorkDaysBanner() {
  const { t } = useTranslation();
  const { isAdmin } = useRoles();
  const { formatDate } = useDateFormat();
  const { showsWashing, showsCleaning } = useWashingCleaningVisibility();
  const today = todayApiDate();
  const { data } = useCommissioningSharesDeliveryDaysList({
    active_at_date_or_future: today,
  });

  const incompleteDays = useMemo(() => {
    const shownFields = (Object.keys(WORK_DAY_LABELS) as WorkDayField[]).filter(
      (field) =>
        (showsWashing || field !== "default_washing_day") &&
        (showsCleaning || field !== "default_cleaning_day"),
    );
    return (data ?? [])
      .map((day) => ({ day, missing: missingWorkDays(day, shownFields) }))
      .filter(({ missing }) => missing.length > 0);
  }, [data, showsWashing, showsCleaning]);

  if (incompleteDays.length === 0) return null;

  return (
    <Alert
      type="error"
      banner
      showIcon
      message={t("commissioning.missing_work_days.title")}
      description={
        <>
          <ul>
            {incompleteDays.map(({ day, missing }) => (
              <li key={day.id}>
                {t(
                  day.valid_from > today
                    ? "commissioning.missing_work_days.day_from"
                    : "commissioning.missing_work_days.day",
                  {
                    day: t(WEEKDAY_KEYS[day.day_number]),
                    date: formatDate(day.valid_from),
                    missing: missing.map((label) => t(label)).join(", "),
                  },
                )}
              </li>
            ))}
          </ul>
          {t("commissioning.missing_work_days.consequence")}{" "}
          {isAdmin ? (
            <Link to="/configuration/time-management">
              {t("commissioning.missing_work_days.link")}
            </Link>
          ) : (
            t("commissioning.missing_work_days.ask_admin")
          )}
        </>
      }
    />
  );
}
