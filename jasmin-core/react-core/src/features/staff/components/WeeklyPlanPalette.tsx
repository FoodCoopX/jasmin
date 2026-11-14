import { useTranslation } from "react-i18next";

import type { WeeklyPlanEmployee } from "@shared/api/generated/models";
import { DraggableChip, ToolTipIcon } from "@shared/ui";

// Every entry in the weekly plan counts as a shift of this many hours.
const HOURS_PER_SHIFT = 8;

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
            const absentOn = employee.absent_days
              .map((day) => t(`commissioning.weekdays.${day}`))
              .join(", ");
            // Against the weekly hours, where the office has set them.
            const hours =
              employee.hours_per_week == null
                ? null
                : {
                    planned: count * HOURS_PER_SHIFT,
                    target: employee.hours_per_week,
                  };
            const ariaHint = [
              t("staff.times_planned", { count }),
              hours && t("staff.hours_planned", hours),
              absentOn && t("staff.absent_on", { days: absentOn }),
            ]
              .filter(Boolean)
              .join(". ");
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
                note={
                  hours && (
                    <span
                      className={
                        hours.planned === hours.target
                          ? "weekly-plan-hours weekly-plan-hours--met"
                          : "weekly-plan-hours weekly-plan-hours--off"
                      }
                    >
                      {t("staff.hours_of", hours)}
                    </span>
                  )
                }
                ariaHint={ariaHint}
              />
            );
          })
        )}
      </div>
    </section>
  );
}
