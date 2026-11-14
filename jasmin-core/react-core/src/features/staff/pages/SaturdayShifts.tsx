import { useMutationState, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import {
  getStaffSaturdayShiftsYearCreateMutationOptions,
  getStaffSaturdayShiftsYearRetrieveQueryKey,
  getStaffWeeklyPlanGridRetrieveQueryKey,
  useStaffSaturdayShiftsYearCreate,
  useStaffSaturdayShiftsYearRetrieve,
} from "@shared/api/generated/staff/staff";
import type {
  SaturdayShiftEmployee,
  SaturdayShiftSetRequest,
  SaturdayShiftYear,
} from "@shared/api/generated/models";
import { useRoles } from "@shared/auth";
import { YearSelector } from "@shared/selectors";
import { ReadOnlyReportTable, type TotalsRow } from "@shared/tables";
import { AutoSaveIndicator, ExplainerText } from "@shared/ui";
import { notify } from "@shared/utils";
import { getErrorMessage } from "@shared/utils/apiError";
import { useYearWeekState } from "@hooks/index";

const SAVE_MUTATION_KEY =
  getStaffSaturdayShiftsYearCreateMutationOptions().mutationKey;

/**
 * A year of Saturday shifts, a cross per ISO week an employee works its
 * Saturday, under a row counting them per week. A cross saves at once. It is
 * the employee's Saturday row in the weekly plan: the server places a new one
 * there, so the plan shows it.
 */
export default function SaturdayShifts() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isOffice } = useRoles();
  const { selectedYear, setSelectedYear, currentYear, currentWeek } =
    useYearWeekState();

  const yearParams = useMemo(() => ({ year: selectedYear }), [selectedYear]);
  const { data: saturdays, isFetching } =
    useStaffSaturdayShiftsYearRetrieve(yearParams);

  // The current year opens on the current week, once per year shown: a save
  // changes the data too, and must not scroll away from the cross just set.
  const tableRef = useRef<HTMLDivElement>(null);
  const scrolledYear = useRef<number | null>(null);
  useEffect(() => {
    if (!saturdays || scrolledYear.current === saturdays.year) return;
    scrolledYear.current = saturdays.year;
    if (saturdays.year !== currentYear) return;
    tableRef.current
      ?.querySelector("th.saturday-shifts-current-week")
      ?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [saturdays, currentYear]);

  // Writes one employee's row into the cached year, leaving the others as
  // they are, so a save's answer can't undo a cross set meanwhile in another
  // row.
  const showEmployee = useCallback(
    (
      year: number,
      employeeId: string,
      change: Partial<SaturdayShiftEmployee>,
    ) =>
      queryClient.setQueryData<SaturdayShiftYear>(
        getStaffSaturdayShiftsYearRetrieveQueryKey({ year }),
        (cached) =>
          cached && {
            ...cached,
            employees: cached.employees.map((employee) =>
              employee.id === employeeId ? { ...employee, ...change } : employee,
            ),
          },
      ),
    [queryClient],
  );

  const { mutate: saveShift, isError: saveFailed } =
    useStaffSaturdayShiftsYearCreate({
      mutation: {
        meta: { silent: true },
        onSuccess: (savedYear, { data }) => {
          const saved = savedYear.employees.find(
            (employee) => employee.id === data.employee_id,
          );
          if (saved) showEmployee(data.year, saved.id, saved);
          queryClient.invalidateQueries({
            queryKey: getStaffWeeklyPlanGridRetrieveQueryKey(),
          });
        },
        onError: (error, { data }) => {
          notify.error(getErrorMessage(error, t("staff.save_failed")));
          queryClient.invalidateQueries({
            queryKey: getStaffSaturdayShiftsYearRetrieveQueryKey({
              year: data.year,
            }),
          });
        },
      },
    });
  // A row waits for its save before it takes the next cross, so an answer
  // never shows the row as it was before a later cross.
  const savingEmployees = useMutationState({
    filters: { mutationKey: SAVE_MUTATION_KEY, status: "pending" },
    select: (mutation) =>
      (
        mutation.state.variables as
          | { data: SaturdayShiftSetRequest }
          | undefined
      )?.data.employee_id,
  });

  const setOnDuty = useCallback(
    (employee: SaturdayShiftEmployee, week: number, onDuty: boolean) => {
      const weeks = onDuty
        ? [...employee.weeks, week].sort((a, b) => a - b)
        : employee.weeks.filter((other) => other !== week);
      showEmployee(selectedYear, employee.id, { weeks });
      saveShift({
        data: {
          year: selectedYear,
          week,
          employee_id: employee.id,
          on_duty: onDuty,
        },
      });
    },
    [saveShift, selectedYear, showEmployee],
  );

  const weekCount = saturdays?.weeks ?? 0;
  // How many work each week's Saturday, under the name and count columns'
  // label, which stays in view as those two columns do.
  const totalsRow = useMemo<TotalsRow | null>(() => {
    if (!saturdays?.employees.length) return null;
    const onDutyPerWeek = new Map<number, number>();
    for (const employee of saturdays.employees) {
      for (const week of employee.weeks) {
        onDutyPerWeek.set(week, (onDutyPerWeek.get(week) ?? 0) + 1);
      }
    }
    const shownCurrentWeek =
      saturdays.year === currentYear ? currentWeek : null;
    return {
      label: t("staff.sum"),
      labelColSpan: 2,
      labelFixed: true,
      cells: Array.from({ length: saturdays.weeks }, (_, index) => ({
        value: onDutyPerWeek.get(index + 1) ?? 0,
        className:
          index + 1 === shownCurrentWeek
            ? "saturday-shifts-current-week"
            : undefined,
      })),
    };
  }, [currentWeek, currentYear, saturdays, t]);

  const columns = useMemo<ColumnsType<SaturdayShiftEmployee>>(() => {
    const crossFor = (employee: SaturdayShiftEmployee, week: number) => {
      const onDuty = employee.weeks.includes(week);
      const absent = employee.absent_weeks.includes(week);
      const label = { employee: employee.short_name_for_weekly_plan, week };
      // No new shift on an absent Saturday or for an inactive employee; one
      // they hold can still be taken away.
      const settable = onDuty || (!absent && employee.is_active);
      return (
        <Checkbox
          checked={onDuty}
          className={onDuty && absent ? "saturday-shift-conflict" : undefined}
          disabled={
            !isOffice || !settable || savingEmployees.includes(employee.id)
          }
          aria-label={
            absent
              ? t("staff.saturday_shift_absent", label)
              : t("staff.saturday_shift", label)
          }
          onChange={(event) => setOnDuty(employee, week, event.target.checked)}
        />
      );
    };
    return [
      {
        title: t("staff.employee"),
        dataIndex: "short_name_for_weekly_plan",
        key: "short_name_for_weekly_plan",
        fixed: "left",
        width: "12em",
        render: (name: string, employee) =>
          employee.is_active
            ? name
            : t("staff.inactive_employee", { employee: name }),
      },
      {
        title: t("staff.saturday_shift_count"),
        key: "count",
        fixed: "left",
        width: "6em",
        align: "center",
        sorter: (a, b) => a.weeks.length - b.weeks.length,
        sortDirections: ["descend", "ascend"],
        showSorterTooltip: false,
        render: (_: unknown, employee) => employee.weeks.length,
      },
      ...Array.from({ length: weekCount }, (_, index) => {
        const week = index + 1;
        const isCurrent = selectedYear === currentYear && week === currentWeek;
        return {
          title: t("staff.week_option", { week }),
          key: `week_${week}`,
          align: "center" as const,
          width: "6.5em",
          className: isCurrent ? "saturday-shifts-current-week" : undefined,
          onHeaderCell: () =>
            isCurrent ? { "aria-current": "date" as const } : {},
          // Ascending puts whoever works that Saturday on top.
          sorter: (a: SaturdayShiftEmployee, b: SaturdayShiftEmployee) =>
            Number(b.weeks.includes(week)) - Number(a.weeks.includes(week)),
          showSorterTooltip: false,
          render: (_: unknown, employee: SaturdayShiftEmployee) =>
            crossFor(employee, week),
        };
      }),
    ];
  }, [
    currentWeek,
    currentYear,
    isOffice,
    savingEmployees,
    selectedYear,
    setOnDuty,
    t,
    weekCount,
  ]);

  return (
    <div>
      <h1>{t("staff.saturday_shifts")}</h1>
      <AutoSaveIndicator
        saving={savingEmployees.length > 0}
        hasChanges={false}
        failed={saveFailed}
      />
      <YearSelector
        selectedYear={selectedYear}
        setSelectedYear={setSelectedYear}
      />
      <div ref={tableRef} className="saturday-shifts-table mt-16">
        <ReadOnlyReportTable<SaturdayShiftEmployee>
          searchable
          totalsRow={totalsRow}
          sortScope={selectedYear}
          rowKey="id"
          columns={columns}
          dataSource={saturdays?.employees ?? []}
          loading={isFetching}
          pagination={false}
          scroll={{ x: "max-content" }}
        />
      </div>
      <ExplainerText title={t("common.info")}>
        {t("explainers.saturday_shifts")}
      </ExplainerText>
    </div>
  );
}
