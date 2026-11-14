import { Button, Select } from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";

import {
  getStaffWeeklyPlanGridRetrieveQueryKey,
  useStaffWeeklyPlanCopyCreate,
} from "@shared/api/generated/staff/staff";
import { notify, previousIsoWeek, weeksInIsoYear } from "@shared/utils";
import { getErrorMessage } from "@shared/utils/apiError";

interface WeeklyPlanCopyToolsProps {
  year: number;
  week: number;
  /** Called once the copy is saved, while the tools are still shown. */
  onCopied: () => void;
}

/**
 * Copies another week's plan into the empty ``week`` of ``year``. The source
 * is the week before by default, in week 1 the last week of the year before;
 * any week of this year or the one before can be picked instead. Render it
 * with a key per week, so a pick never carries over to another week.
 */
export default function WeeklyPlanCopyTools({
  year,
  week,
  onCopied,
}: WeeklyPlanCopyToolsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // A source as "<year>-<week>"; null keeps the default.
  const [pickedSource, setPickedSource] = useState<string | null>(null);
  const lastYear = year - 1;
  const weekBefore = previousIsoWeek(year, week);
  const source = pickedSource ?? `${weekBefore.year}-${weekBefore.week}`;

  const sourceOptions = useMemo(
    () => [
      ...Array.from({ length: weeksInIsoYear(lastYear) }, (_, index) => ({
        value: `${lastYear}-${index + 1}`,
        label: t("staff.week_of_year_option", {
          week: index + 1,
          year: lastYear,
        }),
      })),
      ...Array.from({ length: weeksInIsoYear(year) }, (_, index) => index + 1)
        .filter((other) => other !== week)
        .map((other) => ({
          value: `${year}-${other}`,
          label: t("staff.week_option", { week: other }),
        })),
    ],
    [lastYear, t, week, year],
  );

  const { mutate: copyWeek, isPending: isCopying } =
    useStaffWeeklyPlanCopyCreate({
      mutation: {
        meta: { silent: true },
        onSuccess: () => {
          notify.success(t("staff.weekly_plan_copied_success"));
          queryClient.invalidateQueries({
            queryKey: getStaffWeeklyPlanGridRetrieveQueryKey({ year, week }),
          });
          onCopied();
        },
        onError: (error) => {
          notify.error(
            getErrorMessage(error, t("staff.copy_target_not_empty")),
          );
        },
      },
    });

  const handleCopy = () => {
    const [fromYear, fromWeek] = source.split("-").map(Number);
    copyWeek({
      data: { year, from_year: fromYear, from_week: fromWeek, to_week: week },
    });
  };

  return (
    <div className="weekly-plan-toolbar">
      <div className="weekly-plan-copy">
        <label className="weekly-plan-copy-field">
          {t("staff.copy_weekly_plan_from")}
          <Select
            aria-label={t("staff.copy_weekly_plan_from")}
            size="small"
            showSearch
            optionFilterProp="label"
            className="weekly-plan-copy-select"
            placeholder={t("staff.copy_source_week")}
            value={source}
            onChange={(value) => setPickedSource(value)}
            options={sourceOptions}
          />
        </label>
        <Button
          type="primary"
          size="small"
          onClick={handleCopy}
          loading={isCopying}
        >
          {t("staff.copy_into_this_week")}
        </Button>
      </div>
    </div>
  );
}
