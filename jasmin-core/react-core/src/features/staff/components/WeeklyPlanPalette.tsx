import { useTranslation } from "react-i18next";

import type { WeeklyPlanEmployee } from "@shared/api/generated/models";
import { DraggableChip, ToolTipIcon } from "@shared/ui";

interface WeeklyPlanPaletteProps {
  employees: WeeklyPlanEmployee[];
  planCountByEmployee: Map<string, number>;
  colorMap: Map<string, string>;
  canDrag: boolean;
  /** There are active employees, but all of them are away the working week. */
  everyoneAbsent: boolean;
}

/** The employees the weekly plan offers, each a chip to drag into the grid. */
export default function WeeklyPlanPalette({
  employees,
  planCountByEmployee,
  colorMap,
  canDrag,
  everyoneAbsent,
}: WeeklyPlanPaletteProps) {
  const { t } = useTranslation();

  return (
    <section
      className="weekly-plan-palette"
      aria-labelledby="weekly-plan-employees-heading"
    >
      <h3>
        <span id="weekly-plan-employees-heading">{t("staff.employees")}</span>
        <ToolTipIcon title={t("tooltip.weekly_plan_absent_employees")} />
      </h3>
      <div className="weekly-plan-palette-box">
        {employees.length === 0 ? (
          <p className="color-text-tertiary">
            {t(everyoneAbsent ? "staff.everyone_absent" : "staff.no_employees")}
          </p>
        ) : (
          employees.map((employee) => {
            const count = planCountByEmployee.get(employee.id) ?? 0;
            const timesPlanned = t("staff.times_planned", { count });
            const absentOn = employee.absent_days
              .map((day) => t(`commissioning.weekdays.${day}`))
              .join(", ");
            return (
              <DraggableChip
                key={employee.id}
                chip={{
                  id: employee.id,
                  label: employee.short_name_for_weekly_plan,
                  color: colorMap.get(employee.id),
                }}
                canDrag={canDrag}
                count={count}
                ariaHint={
                  absentOn
                    ? `${timesPlanned}. ${t("staff.absent_on", { days: absentOn })}`
                    : timesPlanned
                }
              />
            );
          })
        )}
      </div>
    </section>
  );
}
