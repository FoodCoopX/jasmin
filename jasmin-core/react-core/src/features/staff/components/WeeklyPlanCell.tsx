import { useTranslation } from "react-i18next";

import type { WeeklyPlanEmployee } from "@shared/api/generated/models";
import { DroppableCell } from "@shared/ui";

interface WeeklyPlanCellProps {
  /** The cell's row in the drag-and-drop grid, which runs through every
   *  category's rows. */
  flatIndex: number;
  categoryName: string;
  rowIndex: number;
  day: number;
  employee: WeeklyPlanEmployee | null;
  color?: string;
  /** The employee is absent that day: a shift planned before the absence. */
  absent: boolean;
  canEdit: boolean;
}

/** One weekday of one row of a weekly-plan category. */
export default function WeeklyPlanCell({
  flatIndex,
  categoryName,
  rowIndex,
  day,
  employee,
  color,
  absent,
  canEdit,
}: WeeklyPlanCellProps) {
  const { t } = useTranslation();
  const occupantLabel =
    employee?.is_active === false
      ? t("staff.inactive_employee", {
          employee: employee.short_name_for_weekly_plan,
        })
      : employee?.short_name_for_weekly_plan ?? "";
  const place = {
    day: t(`commissioning.weekdays.${day}`),
    category: categoryName,
    row: rowIndex + 1,
  };
  let ariaLabel = t("staff.cell_empty", place);
  if (employee) {
    ariaLabel = absent
      ? t("staff.cell_absent", { ...place, employee: occupantLabel })
      : t("staff.cell_filled", { ...place, employee: occupantLabel });
  }

  return (
    <td className="weekly-plan-cell">
      <DroppableCell
        pos={{ row: flatIndex, col: day }}
        occupant={
          employee ? { id: employee.id, label: occupantLabel, color } : null
        }
        canEdit={canEdit}
        flagged={absent}
        emptyLabel={t("staff.drop_employee_here")}
        ariaLabel={ariaLabel}
        removeAriaLabelFor={(label) =>
          t("staff.remove_employee", { employee: label })
        }
      />
    </td>
  );
}
