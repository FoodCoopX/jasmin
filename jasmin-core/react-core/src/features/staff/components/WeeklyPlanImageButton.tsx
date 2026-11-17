import { DownloadOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { WeeklyPlanCategoryGrid } from "@shared/api/generated/models";
import {
  dateForWeekDayNumber,
  downloadBlob,
  formatWeekLabel,
  generatePdfFilename,
  notify,
} from "@shared/utils";
import { useDateFormat } from "@hooks/index";
import { STAFF_WEEKDAYS } from "@features/staff/utils/weekdays";
import {
  filledRows,
  renderWeeklyPlanPng,
  type WeeklyPlanImageCell,
} from "@features/staff/utils/weeklyPlanImage";

interface WeeklyPlanImageButtonProps {
  year: number;
  week: number;
  categories: WeeklyPlanCategoryGrid[];
  /** What a cell of the grid shows, or null while it is empty. */
  cellAt: (
    categoryId: string,
    rowIndex: number,
    day: number,
  ) => WeeklyPlanImageCell | null;
  disabled: boolean;
}

/** Downloads the week's plan as a PNG, to post in a chat group. */
export default function WeeklyPlanImageButton({
  year,
  week,
  categories,
  cellAt,
  disabled,
}: WeeklyPlanImageButtonProps) {
  const { t } = useTranslation();
  const { formatDate, mobileDateFormat } = useDateFormat();
  const [rendering, setRendering] = useState(false);

  const handleClick = async () => {
    setRendering(true);
    try {
      const dateOf = (day: number) => dateForWeekDayNumber(year, week, day);
      const png = await renderWeeklyPlanPng({
        title: t("staff.weekly_plan_image_title", {
          week,
          from: formatDate(dateOf(STAFF_WEEKDAYS[0])),
          until: formatDate(dateOf(STAFF_WEEKDAYS[STAFF_WEEKDAYS.length - 1])),
        }),
        days: STAFF_WEEKDAYS.map((day) => ({
          name: t(`commissioning.weekdays.${day}`),
          date: formatDate(dateOf(day), mobileDateFormat) ?? "",
        })),
        categories: categories.map((category) => ({
          name: category.name,
          rows: filledRows(
            Array.from({ length: category.max_lines }, (_, rowIndex) =>
              STAFF_WEEKDAYS.map((day) => cellAt(category.id, rowIndex, day)),
            ),
            STAFF_WEEKDAYS.length,
          ),
        })),
      });
      const filename = generatePdfFilename([
        t("staff.weekly_staff_plan"),
        year,
        formatWeekLabel(week, t),
      ]);
      downloadBlob(png, `${filename}.png`);
    } catch {
      notify.error(t("common.error_exporting"));
    } finally {
      setRendering(false);
    }
  };

  return (
    <Button
      type="primary"
      className="download-button"
      icon={<DownloadOutlined />}
      onClick={handleClick}
      loading={rendering}
      disabled={disabled}
    >
      {t("staff.weekly_plan_png")}
    </Button>
  );
}
