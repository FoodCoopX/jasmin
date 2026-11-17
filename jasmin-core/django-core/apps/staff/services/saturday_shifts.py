"""Saturday shifts: who works on the Saturday of each ISO week of a year, as
the Saturday-shift page shows and edits them.

A Saturday shift is the employee's Saturday row in the weekly plan, so the page
and the plan never disagree: setting one adds a row in the active category with
the most rows that still has one free, and taking it away removes every
Saturday row the employee has that week. An employee planned on a Saturday in
the weekly plan has a Saturday shift as well. A row the weekly plan doesn't
show — in a deactivated category, or past its category's ``max_lines`` — is no
shift: the next save of that week deletes it.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from django.db import transaction
from django.db.models import F, Q, QuerySet

from apps.shared.query_params import weeks_in_iso_year

from ..errors import (
    EmployeeAbsent,
    EmployeeInactive,
    EmployeeNotFound,
    SaturdayShiftNoPlace,
    StaffError,
)
from ..models import Absence, Employee, WeeklyPlan, WeeklyPlanCategory
from .weekly_plan import SATURDAY, weekly_plan_lock


def _saturday_shifts(year: int) -> QuerySet[WeeklyPlan]:
    """The Saturday rows of ``year`` the weekly plan shows."""
    return WeeklyPlan.objects.filter(
        year=year,
        day=SATURDAY,
        weekly_plan_category__is_active=True,
        row_index__lt=F("weekly_plan_category__max_lines"),
    )


def build_saturday_year(year: int) -> dict[str, Any]:
    """The Saturday shifts of ``year``, of the active employees and of inactive
    ones who still have one, each with the weeks whose Saturday they are
    absent on. Three queries."""
    on_duty: dict[str, set[int]] = defaultdict(set)
    for employee_id, week in _saturday_shifts(year).values_list("employee_id", "week"):
        on_duty[employee_id].add(week)
    absent: dict[str, set[int]] = defaultdict(set)
    for employee_id, week in Absence.objects.filter(
        year=year, day=SATURDAY
    ).values_list("employee_id", "week"):
        absent[employee_id].add(week)

    employees = [
        {
            **employee,
            "weeks": sorted(on_duty[employee["id"]]),
            "absent_weeks": sorted(absent[employee["id"]]),
        }
        for employee in Employee.objects.filter(
            Q(is_active=True) | Q(id__in=list(on_duty))
        )
        .order_by("short_name_for_weekly_plan")
        .values("id", "short_name_for_weekly_plan", "is_active")
    ]
    return {"year": year, "weeks": weeks_in_iso_year(year), "employees": employees}


@transaction.atomic
def set_saturday_shift(
    year: int, week: int, employee_id: str, *, on_duty: bool
) -> None:
    """Give the employee a Saturday shift in ``(year, week)``, or take it away.
    Setting one the employee has, or taking away one they don't, changes
    nothing."""
    if week > weeks_in_iso_year(year):
        raise StaffError(f"{year} has no ISO week {week}.", field="week")
    employee = Employee.objects.filter(pk=employee_id).only("is_active").first()
    if employee is None:
        raise EmployeeNotFound(f"Unknown employee: {employee_id}", field="employee_id")

    weekly_plan_lock(year, week)
    saturday_rows = WeeklyPlan.objects.filter(year=year, week=week, day=SATURDAY)
    if not on_duty:
        saturday_rows.filter(employee_id=employee_id).delete()
        return
    if _saturday_shifts(year).filter(week=week, employee_id=employee_id).exists():
        return
    if not employee.is_active:
        raise EmployeeInactive(
            f"Employee {employee_id} is deactivated.", field="employee_id"
        )
    if Absence.objects.filter(
        year=year, week=week, day=SATURDAY, employee_id=employee_id
    ).exists():
        raise EmployeeAbsent(
            f"Employee {employee_id} is absent on the Saturday of week {week}.",
            field="week",
            details={"employee_id": employee_id, "day": SATURDAY},
        )

    taken = set(saturday_rows.values_list("weekly_plan_category_id", "row_index"))
    for category in WeeklyPlanCategory.objects.filter(is_active=True).order_by(
        "-max_lines", "sort_order", "name"
    ):
        for row_index in range(category.max_lines):
            if (category.pk, row_index) not in taken:
                WeeklyPlan.objects.create(
                    year=year,
                    week=week,
                    day=SATURDAY,
                    weekly_plan_category=category,
                    employee_id=employee_id,
                    row_index=row_index,
                )
                return
    raise SaturdayShiftNoPlace(
        f"No active weekly-plan category has a free row on the Saturday of "
        f"week {week}.",
        field="week",
    )
