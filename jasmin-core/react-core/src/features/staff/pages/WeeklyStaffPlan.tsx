import { Alert } from "antd";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  useStaffWeeklyPlanCreate,
  useStaffWeeklyPlanGridRetrieve,
} from "@shared/api/generated/staff/staff";
import type {
  WeeklyPlanEmployee,
  WeeklyPlanGrid,
} from "@shared/api/generated/models";
import { useRoles } from "@shared/auth";
import { WeekSelector } from "@shared/selectors";
import {
  AutoSaveIndicator,
  DndGrid,
  usePastelColorMap,
} from "@shared/ui";
import type { DndDragPayload, GridPos } from "@shared/ui";
import { notify } from "@shared/utils";
import { getErrorMessage } from "@shared/utils/apiError";
import WeeklyPlanCell from "@features/staff/components/WeeklyPlanCell";
import WeeklyPlanCopyTools from "@features/staff/components/WeeklyPlanCopyTools";
import WeeklyPlanPalette from "@features/staff/components/WeeklyPlanPalette";
import { STAFF_WEEKDAYS } from "@features/staff/utils/weekdays";

dayjs.extend(isoWeek);

// Absent on all of them, an employee is left out of the palette.
const WORKDAYS = [0, 1, 2, 3, 4];
const SATURDAY = 5;

/** A flat grid row: which category + which line inside it. ``pos.row`` indexes
 *  into the flat list; ``pos.col`` is the weekday. */
interface FlatRow {
  categoryId: string;
  rowIndex: number;
}

const cellKey = (categoryId: string, rowIndex: number, day: number) =>
  `${categoryId}|${rowIndex}|${day}`;

/** The filled cells of a week's grid, keyed by `cellKey`. */
function cellsFromGrid(grid: WeeklyPlanGrid): Record<string, string> {
  const filled: Record<string, string> = {};
  grid.categories.forEach((category) =>
    category.rows.forEach((row) =>
      Object.entries(row.days).forEach(([day, employeeId]) => {
        if (employeeId) {
          filled[cellKey(category.id, row.row_index, Number(day))] = employeeId;
        }
      }),
    ),
  );
  return filled;
}

/** True if any employee appears more than once in the same (category, day) —
 *  the invariant we enforce: a person may work several categories/days, but not
 *  the same category twice on one day (across rows). */
function hasCategoryDayDuplicate(state: Record<string, string>): boolean {
  const seen = new Set<string>();
  for (const [key, employeeId] of Object.entries(state)) {
    const [categoryId, , day] = key.split("|");
    const slot = `${categoryId}|${day}|${employeeId}`;
    if (seen.has(slot)) return true;
    seen.add(slot);
  }
  return false;
}

export default function WeeklyStaffPlan() {
  const { t } = useTranslation();
  const { isOffice } = useRoles();

  const [selectedYear, setSelectedYear] = useState<number>(() =>
    dayjs().isoWeekYear(),
  );
  const [selectedWeek, setSelectedWeek] = useState<number>(() =>
    dayjs().isoWeek(),
  );
  const listParams = useMemo(
    () => ({ year: selectedYear, week: selectedWeek ?? 1 }),
    [selectedYear, selectedWeek],
  );

  const {
    data: grid,
    isFetching,
    refetch: refetchGrid,
  } = useStaffWeeklyPlanGridRetrieve(listParams, {
    query: { enabled: selectedWeek != null },
  });

  // Editable grid state: filled cells only, keyed by `${category}|${row}|${day}`.
  const [cells, setCells] = useState<Record<string, string>>({});
  // Freshest cells for the DnD handlers (they run on DOM events, not in render).
  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  // Only a genuine user edit (place / remove / move) should POST — NOT the load
  // effect that seeds `cells` from a freshly-fetched week. A ref the edit
  // handlers set flags real edits (mirrors the DeliveryTours pattern).
  const userEditedRef = useRef(false);

  // Seed local state whenever a new week's grid arrives.
  useEffect(() => {
    if (grid) setCells(cellsFromGrid(grid));
  }, [grid]);

  // The grid lists a deactivated employee only while they hold a shift this
  // week, so the shift shows; the palette offers the active ones alone, and
  // of them not those absent the whole working week.
  const employees: WeeklyPlanEmployee[] = useMemo(
    () => grid?.employees ?? [],
    [grid],
  );
  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.is_active !== false),
    [employees],
  );
  const paletteEmployees = useMemo(
    () =>
      activeEmployees.filter(
        (employee) =>
          !WORKDAYS.every((day) => employee.absent_days.includes(day)),
      ),
    [activeEmployees],
  );
  const employeeById = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees],
  );
  // From the active employees, so a colour doesn't change with the week's
  // absences.
  const colorMap = usePastelColorMap(
    useMemo(() => activeEmployees.map((e) => e.id), [activeEmployees]),
  );
  const absentDaysByEmployee = useMemo(
    () => new Map(employees.map((e) => [e.id, new Set(e.absent_days)])),
    [employees],
  );
  const isAbsent = useCallback(
    (employeeId: string, day: number) =>
      absentDaysByEmployee.get(employeeId)?.has(day) ?? false,
    [absentDaysByEmployee],
  );

  // Live tally of how many cells each employee fills in the visible week —
  // shown as a small badge on their palette chip.
  const planCountByEmployee = useMemo(() => {
    const counts = new Map<string, number>();
    for (const employeeId of Object.values(cells)) {
      counts.set(employeeId, (counts.get(employeeId) ?? 0) + 1);
    }
    return counts;
  }, [cells]);

  // Shifts that fall on an absence, planned before it was known. They stay
  // until the office moves them; the grid marks them, on the days it shows.
  const conflictCount = useMemo(
    () =>
      Object.entries(cells).filter(([key, employeeId]) => {
        const day = Number(key.split("|")[2]);
        return STAFF_WEEKDAYS.includes(day) && isAbsent(employeeId, day);
      }).length,
    [cells, isAbsent],
  );

  // Flat row list (for pos.row) + its reverse (category,row → flat index).
  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    grid?.categories.forEach((category) => {
      for (let rowIndex = 0; rowIndex < category.max_lines; rowIndex++) {
        rows.push({ categoryId: category.id, rowIndex });
      }
    });
    return rows;
  }, [grid]);
  const flatRowsRef = useRef<FlatRow[]>([]);
  flatRowsRef.current = flatRows;
  const flatIndexByCell = useMemo(() => {
    const map = new Map<string, number>();
    flatRows.forEach((r, index) =>
      map.set(`${r.categoryId}|${r.rowIndex}`, index),
    );
    return map;
  }, [flatRows]);

  // The page reports a refused save itself, so the app-wide mutation toast
  // stays silent. Each save sends the whole week, so they run one after the
  // other: an earlier one must never land last.
  const {
    mutate: save,
    isPending: isSaving,
    isError: saveFailed,
  } = useStaffWeeklyPlanCreate({
    mutation: {
      scope: { id: "weekly-plan-save" },
      meta: { silent: true },
      onError: (error) => {
        notify.error(getErrorMessage(error, t("staff.save_failed")));
      },
    },
  });
  // Counts the saves started, so a refused one can tell whether a newer save
  // has started since.
  const saveCountRef = useRef(0);

  // Auto-save the whole week on any real edit (last-write-wins replace-all).
  useEffect(() => {
    if (!userEditedRef.current) return;
    userEditedRef.current = false;
    if (selectedWeek == null) return;
    const assignments = Object.entries(cells).map(([key, employeeId]) => {
      const [categoryId, rowIndex, day] = key.split("|");
      return {
        category_id: categoryId,
        row_index: Number(rowIndex),
        day: Number(day),
        employee_id: employeeId,
      };
    });
    const saveNumber = ++saveCountRef.current;
    save(
      { data: { year: selectedYear, week: selectedWeek, assignments } },
      {
        // Only the latest save's refusal lands here. Put the week back as the
        // server stores it, unless a newer save has started meanwhile. The
        // refetch alone wouldn't: when the server kept the week unchanged, the
        // refetched grid is the same object, and its seeding effect stays put.
        onError: () => {
          void refetchGrid().then(({ data }) => {
            if (data && saveNumber === saveCountRef.current) {
              setCells(cellsFromGrid(data));
            }
          });
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saves only on a user edit, reading the week as of it
  }, [cells]);

  const handlePlace = useCallback(
    (payload: DndDragPayload, to: GridPos) => {
      const target = flatRowsRef.current[to.row];
      if (!target) return;

      const next = { ...cellsRef.current };
      const targetKey = cellKey(target.categoryId, target.rowIndex, to.col);
      if (payload.from) {
        const source = flatRowsRef.current[payload.from.row];
        if (!source) return;
        const sourceKey = cellKey(
          source.categoryId,
          source.rowIndex,
          payload.from.col,
        );
        const moved = next[sourceKey];
        // A pick-up kept over a week switch or a refetch may point at a cell
        // that holds someone else by now: move no one rather than them.
        if (moved !== payload.chip.id) return;
        const displaced = next[targetKey];
        delete next[sourceKey];
        next[targetKey] = moved;
        // Swap: the target's previous occupant falls back into the source cell.
        if (displaced !== undefined) next[sourceKey] = displaced;
      } else {
        // From the palette: repeatable ACROSS categories/days — an employee may
        // fill many cells, just not the same category twice on one day.
        next[targetKey] = payload.chip.id;
      }

      // Enforce the one-per-category-per-day rule client-side: reject the drop
      // (leave the grid untouched) rather than create a duplicate.
      if (hasCategoryDayDuplicate(next)) {
        notify.warning(t("staff.already_in_category_that_day"));
        return;
      }

      userEditedRef.current = true;
      setCells(next);
    },
    [t],
  );

  // No one goes to a day they're absent: not the chip placed, nor, in a swap,
  // the occupant it sends back to the chip's old day.
  const canPlace = useCallback(
    (payload: DndDragPayload, to: GridPos) => {
      if (isAbsent(payload.chip.id, to.col)) return false;
      const target = flatRowsRef.current[to.row];
      if (!payload.from || !target) return true;
      const displaced =
        cellsRef.current[cellKey(target.categoryId, target.rowIndex, to.col)];
      return !displaced || !isAbsent(displaced, payload.from.col);
    },
    [isAbsent],
  );

  const handleRemove = useCallback((pos: GridPos) => {
    const target = flatRowsRef.current[pos.row];
    if (!target) return;
    userEditedRef.current = true;
    setCells((prev) => {
      const next = { ...prev };
      delete next[cellKey(target.categoryId, target.rowIndex, pos.col)];
      return next;
    });
  }, []);

  // The Saturday holds the Saturday shifts, set on their own page: a copy
  // leaves it out, so a week planned on the Saturday alone takes one.
  const currentWeekIsEmpty = Object.keys(cells).every(
    (key) => Number(key.split("|")[2]) === SATURDAY,
  );

  // Focus the grid region after a copy: the copy tools go once the week is no
  // longer empty, so keyboard focus would otherwise be lost.
  const gridRegionRef = useRef<HTMLElement>(null);

  const hasCategories = (grid?.categories.length ?? 0) > 0;

  return (
    <>
      <h1>{t("staff.weekly_staff_plan")}</h1>
      <AutoSaveIndicator
        saving={isSaving}
        hasChanges={false}
        failed={saveFailed}
      />
      <WeekSelector
        selectedYear={selectedYear}
        setSelectedYear={setSelectedYear}
        selectedWeek={selectedWeek}
        setSelectedWeek={setSelectedWeek}
      />
      {isOffice && currentWeekIsEmpty && (
        <WeeklyPlanCopyTools
          key={`${selectedYear}-${selectedWeek}`}
          year={selectedYear}
          week={selectedWeek}
          onCopied={() => gridRegionRef.current?.focus()}
        />
      )}
      {conflictCount > 0 && (
        <Alert
          type="warning"
          showIcon
          className="mb-1em"
          message={t("staff.absence_conflicts", { count: conflictCount })}
        />
      )}
      <DndGrid
        onPlace={handlePlace}
        onRemove={handleRemove}
        canPlace={canPlace}
      >
        <div className="weekly-plan-page">
          {selectedWeek == null ? (
            <p className="color-text-tertiary">{t("staff.select_week")}</p>
          ) : !grid ? null : !hasCategories ? (
            <p className="color-text-tertiary">{t("staff.no_categories")}</p>
          ) : (
            <div className="weekly-plan-layout">
              <WeeklyPlanPalette
                employees={paletteEmployees}
                planCountByEmployee={planCountByEmployee}
                colorMap={colorMap}
                canDrag={isOffice}
                everyoneAbsent={activeEmployees.length > 0}
              />

              <section
                className="weekly-plan-grid-wrap"
                aria-label={t("staff.grid_caption", {
                  week: selectedWeek,
                  year: selectedYear,
                })}
                tabIndex={-1}
                ref={gridRegionRef}
              >
                <table
                  className="weekly-plan-grid-table"
                  aria-label={t("staff.grid_caption", {
                    week: selectedWeek,
                    year: selectedYear,
                  })}
                >
                  <thead>
                    <tr>
                      <th className="weekly-plan-th-row-label" scope="col" />
                      {STAFF_WEEKDAYS.map((day) => (
                        <th key={day} scope="col">
                          {t(`commissioning.weekdays.${day}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  {grid?.categories.map((category) => (
                    <tbody
                      key={category.id}
                      className="weekly-plan-category-group"
                    >
                      <tr className="weekly-plan-category-row">
                        <th colSpan={STAFF_WEEKDAYS.length + 1} scope="colgroup">
                          {category.name}
                        </th>
                      </tr>
                      {Array.from(
                        { length: category.max_lines },
                        (_, rowIndex) => (
                          <tr key={`${category.id}-${rowIndex}`}>
                            <th className="weekly-plan-row-label" scope="row">
                              {rowIndex + 1}
                            </th>
                            {STAFF_WEEKDAYS.map((day) => {
                              const employeeId =
                                cells[cellKey(category.id, rowIndex, day)];
                              const employee = employeeId
                                ? (employeeById.get(employeeId) ?? null)
                                : null;
                              const absent =
                                !!employee && isAbsent(employee.id, day);
                              // No tint for an inactive employee, who has no
                              // palette colour, nor on an absence, shown red.
                              const tinted =
                                employee?.is_active !== false && !absent;
                              return (
                                <WeeklyPlanCell
                                  key={day}
                                  flatIndex={
                                    flatIndexByCell.get(
                                      `${category.id}|${rowIndex}`,
                                    ) ?? 0
                                  }
                                  categoryName={category.name}
                                  rowIndex={rowIndex}
                                  day={day}
                                  employee={employee}
                                  color={
                                    employee && tinted
                                      ? colorMap.get(employee.id)
                                      : undefined
                                  }
                                  absent={absent}
                                  canEdit={isOffice}
                                />
                              );
                            })}
                          </tr>
                        ),
                      )}
                    </tbody>
                  ))}
                </table>
              </section>
            </div>
          )}

          {isFetching && !grid && (
            <p className="color-text-tertiary">{t("common.loading")}</p>
          )}
        </div>
      </DndGrid>
    </>
  );
}
