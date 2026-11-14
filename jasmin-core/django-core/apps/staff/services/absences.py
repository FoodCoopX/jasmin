"""The absences of one ISO week, as the absence page shows and edits them: a
row per employee, a cell per weekday (Mon=0 .. Sun=6) holding the category of
the day's absence, if any. ``Absence`` stores the filled cells only."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from django.db import transaction
from django.db.models import Q

from ..errors import AbsenceCategoryNotFound, AbsencesFromHrSystem, EmployeeNotFound
from ..models import Absence, AbsenceCategory, Employee
from .weekly_plan import WEEKDAYS


def build_absence_week(year: int, week: int) -> dict[str, Any]:
    """The week's absences of the active employees, and of inactive ones who
    still have one that week, with every category — inactive ones too, so a
    day keeps showing the category it has."""
    categories = list(
        AbsenceCategory.objects.order_by("name").values(
            "id", "name", "is_active", "is_default"
        )
    )
    category_by_day: dict[str, dict[str, str]] = defaultdict(dict)
    for employee_id, day, category_id in Absence.objects.filter(
        year=year, week=week
    ).values_list("employee_id", "day", "absence_category_id"):
        category_by_day[employee_id][str(day)] = category_id

    employees = [
        {
            **employee,
            "days": {
                str(day): category_by_day[employee["id"]].get(str(day))
                for day in WEEKDAYS
            },
        }
        for employee in Employee.objects.filter(
            Q(is_active=True) | Q(id__in=list(category_by_day))
        )
        .order_by("short_name_for_weekly_plan")
        .values("id", "short_name_for_weekly_plan", "is_active", "comes_from_hr_system")
    ]
    return {
        "year": year,
        "week": week,
        "categories": categories,
        "employees": employees,
    }


@transaction.atomic
def replace_employee_week(
    year: int,
    week: int,
    employee_id: str,
    days: dict[int, str | None],
    *,
    uses_hr_system: bool,
) -> None:
    """Replace one employee's absences in ``(year, week)``: a day with a
    category becomes an absence of it, one without none."""
    employee = Employee.objects.filter(pk=employee_id).first()
    if employee is None:
        raise EmployeeNotFound(f"Unknown employee: {employee_id}", field="employee_id")
    if uses_hr_system and employee.comes_from_hr_system:
        raise AbsencesFromHrSystem(
            "This employee's absences come from the HR system.",
            field="employee_id",
        )

    category_ids = {category_id for category_id in days.values() if category_id}
    unknown = category_ids - set(
        AbsenceCategory.objects.filter(pk__in=category_ids).values_list("pk", flat=True)
    )
    if unknown:
        raise AbsenceCategoryNotFound(
            f"Unknown absence category: {', '.join(sorted(unknown))}", field="days"
        )

    Absence.objects.filter(year=year, week=week, employee_id=employee_id).delete()
    Absence.objects.bulk_create(
        Absence(
            year=year,
            week=week,
            day=day,
            employee_id=employee_id,
            absence_category_id=category_id,
        )
        for day, category_id in days.items()
        if category_id
    )
