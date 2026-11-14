import { useMutationState, useQueryClient } from "@tanstack/react-query";
import { Checkbox, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  getStaffAbsencesWeekCreateMutationOptions,
  getStaffAbsencesWeekRetrieveQueryKey,
  getStaffEmployeesListQueryKey,
  getStaffWeeklyPlanGridRetrieveQueryKey,
  useStaffAbsencesSyncFromHrSystemCreate,
  useStaffAbsencesWeekCreate,
  useStaffAbsencesWeekRetrieve,
} from "@shared/api/generated/staff/staff";
import type {
  AbsenceWeek,
  AbsenceWeekEmployee,
  AbsenceWeekReplaceRequest,
  StaffAbsencesWeekRetrieveParams,
} from "@shared/api/generated/models";
import { useRoles } from "@shared/auth";
import { WeekSelector } from "@shared/selectors";
import { ReadOnlyReportTable, type TotalsRow } from "@shared/tables";
import { AutoSaveIndicator, ExplainerText } from "@shared/ui";
import { notify } from "@shared/utils";
import { getErrorMessage } from "@shared/utils/apiError";
import { useTenant, useYearWeekState } from "@hooks/index";
import HrSystemSyncButton from "@features/staff/components/HrSystemSyncButton";
import { useHrSystemSyncRefusal } from "@features/staff/hooks/useHrSystemSyncRefusal";
import { STAFF_WEEKDAYS } from "@features/staff/utils/weekdays";

const SAVE_MUTATION_KEY =
  getStaffAbsencesWeekCreateMutationOptions().mutationKey;

/**
 * A week of absences, a cross per day an employee is away, under a row
 * counting them per day. A cross saves at once and files the day under the
 * default category, as the page offers no other; Sunday, which the page leaves
 * out, is sent back as it was.
 */
export default function Absences() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isOffice } = useRoles();
  const { getSetting } = useTenant();
  const usesHrSystem = Boolean(getSetting("uses_hr_system", false));
  const { selectedYear, setSelectedYear, selectedWeek, setSelectedWeek } =
    useYearWeekState();

  const weekParams = useMemo<StaffAbsencesWeekRetrieveParams>(
    () => ({ year: selectedYear, week: selectedWeek }),
    [selectedYear, selectedWeek],
  );
  const { data: absenceWeek, isFetching } =
    useStaffAbsencesWeekRetrieve(weekParams);
  const defaultCategoryId = absenceWeek?.categories.find(
    (category) => category.is_default,
  )?.id;

  // Writes one employee's row into the cached week, leaving the others as
  // they are, so a save's answer can't undo a cross set meanwhile in
  // another row.
  const showEmployee = useCallback(
    (
      { year, week, employee_id }: AbsenceWeekReplaceRequest,
      change: Partial<AbsenceWeekEmployee>,
    ) =>
      queryClient.setQueryData<AbsenceWeek>(
        getStaffAbsencesWeekRetrieveQueryKey({ year, week }),
        (cached) =>
          cached && {
            ...cached,
            employees: cached.employees.map((employee) =>
              employee.id === employee_id
                ? { ...employee, ...change }
                : employee,
            ),
          },
      ),
    [queryClient],
  );

  const { mutate: saveDays, isError: saveFailed } = useStaffAbsencesWeekCreate({
    mutation: {
      meta: { silent: true },
      onSuccess: (savedWeek, { data }) => {
        const saved = savedWeek.employees.find(
          (employee) => employee.id === data.employee_id,
        );
        if (saved) showEmployee(data, saved);
        queryClient.invalidateQueries({
          queryKey: getStaffWeeklyPlanGridRetrieveQueryKey(),
        });
      },
      onError: (error, { data }) => {
        notify.error(getErrorMessage(error, t("staff.save_failed")));
        queryClient.invalidateQueries({
          queryKey: getStaffAbsencesWeekRetrieveQueryKey({
            year: data.year,
            week: data.week,
          }),
        });
      },
    },
  });
  // A row waits for its save before it takes the next cross: each save sends
  // the employee's whole week.
  const savingEmployees = useMutationState({
    filters: { mutationKey: SAVE_MUTATION_KEY, status: "pending" },
    select: (mutation) =>
      (
        mutation.state.variables as
          | { data: AbsenceWeekReplaceRequest }
          | undefined
      )?.data.employee_id,
  });

  const setAbsent = useCallback(
    (employee: AbsenceWeekEmployee, day: number, absent: boolean) => {
      const request = {
        ...weekParams,
        employee_id: employee.id,
        days: {
          ...employee.days,
          [String(day)]: absent ? (defaultCategoryId ?? null) : null,
        },
      };
      showEmployee(request, { days: request.days });
      saveDays({ data: request });
    },
    [defaultCategoryId, saveDays, showEmployee, weekParams],
  );

  const columns = useMemo<ColumnsType<AbsenceWeekEmployee>>(() => {
    // The HR system's employees have their absences from there.
    const editable = (employee: AbsenceWeekEmployee) =>
      isOffice &&
      Boolean(defaultCategoryId) &&
      !(usesHrSystem && employee.comes_from_hr_system) &&
      !savingEmployees.includes(employee.id);
    return [
      {
        title: t("staff.employee"),
        dataIndex: "short_name_for_weekly_plan",
        key: "short_name_for_weekly_plan",
        // Room for the name and the time-tracking tag on one line.
        width: "16em",
        render: (name: string, employee) => (
          <>
            {employee.is_active
              ? name
              : t("staff.inactive_employee", { employee: name })}
            {usesHrSystem && employee.comes_from_hr_system && (
              <Tag color="magenta" className="hr-system-tag">
                {t("staff.hr_system_tag")}
              </Tag>
            )}
          </>
        ),
      },
      ...STAFF_WEEKDAYS.map((day) => ({
        title: t(`commissioning.weekdays.${day}`),
        key: `day_${day}`,
        align: "center" as const,
        // Ascending puts whoever is away that day on top.
        sorter: (a: AbsenceWeekEmployee, b: AbsenceWeekEmployee) =>
          Number(Boolean(b.days[String(day)])) -
          Number(Boolean(a.days[String(day)])),
        showSorterTooltip: false,
        render: (_: unknown, employee: AbsenceWeekEmployee) => {
          const fromHrSystem = usesHrSystem && employee.comes_from_hr_system;
          return (
            <Checkbox
              checked={Boolean(employee.days[String(day)])}
              disabled={!editable(employee)}
              // A cross no one may change here stays greyed out, but in red.
              className={fromHrSystem || !isOffice ? "absence-locked" : undefined}
              aria-label={t(
                fromHrSystem
                  ? "staff.absent_on_day_hr_system"
                  : "staff.absent_on_day",
                {
                  employee: employee.short_name_for_weekly_plan,
                  day: t(`commissioning.weekdays.${day}`),
                },
              )}
              onChange={(event) =>
                setAbsent(employee, day, event.target.checked)
              }
            />
          );
        },
      })),
    ];
  }, [
    defaultCategoryId,
    isOffice,
    savingEmployees,
    setAbsent,
    t,
    usesHrSystem,
  ]);

  // How many are away each day.
  const totalsRow = useMemo<TotalsRow | null>(() => {
    const employees = absenceWeek?.employees ?? [];
    if (!employees.length) return null;
    return {
      label: t("staff.sum"),
      labelColSpan: 1,
      cells: STAFF_WEEKDAYS.map((day) => ({
        value: employees.filter((employee) => employee.days[String(day)])
          .length,
      })),
    };
  }, [absenceWeek, t]);

  const { handleRefusal, confirmHolder } = useHrSystemSyncRefusal();
  const { mutate: syncFromHrSystem, isPending: syncing } =
    useStaffAbsencesSyncFromHrSystemCreate({
      mutation: {
        meta: { silent: true },
        onSuccess: ({ employees, absences }) => {
          notify.success(t("staff.hr_system_absences_synced", { ...absences }));
          if (employees.created + employees.updated + employees.deactivated) {
            notify.success(t("staff.hr_system_synced", { ...employees }));
          }
          if (absences.conflicts > 0) {
            notify.warning(
              t("staff.hr_system_absence_conflicts", {
                count: absences.conflicts,
              }),
            );
          }
          for (const queryKey of [
            getStaffAbsencesWeekRetrieveQueryKey(),
            getStaffWeeklyPlanGridRetrieveQueryKey(),
            getStaffEmployeesListQueryKey(),
          ]) {
            queryClient.invalidateQueries({ queryKey });
          }
        },
        onError: (error) =>
          handleRefusal(error, () =>
            syncFromHrSystem({ data: { confirm_deactivations: true } }),
          ),
      },
    });

  return (
    <div>
      <h1>{t("staff.absences")}</h1>
      {usesHrSystem && isOffice && (
        <div className="mb-12">
          <HrSystemSyncButton
            syncing={syncing}
            onSync={() => syncFromHrSystem({ data: {} })}
          />
        </div>
      )}
      <AutoSaveIndicator
        saving={savingEmployees.length > 0}
        hasChanges={false}
        failed={saveFailed}
      />
      <WeekSelector
        selectedYear={selectedYear}
        setSelectedYear={setSelectedYear}
        selectedWeek={selectedWeek}
        setSelectedWeek={(week) => week !== null && setSelectedWeek(week)}
      />
      <div className="mt-16">
        <ReadOnlyReportTable<AbsenceWeekEmployee>
          className="w-max custom-jasmin-table"
          searchable
          totalsRow={totalsRow}
          sortScope={`${selectedYear}-${selectedWeek}`}
          rowKey="id"
          columns={columns}
          dataSource={absenceWeek?.employees ?? []}
          loading={isFetching}
          pagination={false}
        />
      </div>
      <ExplainerText title={t("common.info")}>
        {t(
          usesHrSystem
            ? "explainers.absences_hr_system"
            : "explainers.absences",
        )}
      </ExplainerText>
      {confirmHolder}
    </div>
  );
}
