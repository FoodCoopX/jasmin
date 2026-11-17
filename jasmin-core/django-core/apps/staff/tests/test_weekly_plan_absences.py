"""The weekly plan around absences: the grid names each employee's days of
absence, a new shift on one is refused, one planned before the absence stays,
and a copied week leaves those days out."""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status

from apps.staff.models import (
    Absence,
    AbsenceCategory,
    Employee,
    WeeklyPlan,
    WeeklyPlanCategory,
)

pytestmark = pytest.mark.django_db

YEAR = 2031
WEEK = 10


@pytest.fixture()
def field(tenant):
    return WeeklyPlanCategory.objects.create(name="Field", max_lines=3)


@pytest.fixture()
def anna(tenant):
    return Employee.objects.create(short_name_for_weekly_plan="Anna")


def _absent(employee, day, week=WEEK):
    Absence.objects.create(
        year=YEAR,
        week=week,
        day=day,
        employee=employee,
        absence_category=AbsenceCategory.default(),
    )


def _plan(employee, category, day, week=WEEK, row_index=0):
    return WeeklyPlan.objects.create(
        year=YEAR,
        week=week,
        day=day,
        weekly_plan_category=category,
        employee=employee,
        row_index=row_index,
    )


def _save(client, assignments):
    return client.post(
        reverse("weekly_plan-list"),
        {"year": YEAR, "week": WEEK, "assignments": assignments},
        format="json",
    )


def _assignment(employee, category, day, row_index=0):
    return {
        "category_id": category.pk,
        "row_index": row_index,
        "day": day,
        "employee_id": employee.pk,
    }


def test_the_grid_names_each_employees_days_of_absence(api_client, field, anna):
    Employee.objects.create(short_name_for_weekly_plan="Ben")
    _absent(anna, 3)
    _absent(anna, 1)
    _absent(anna, 4, week=WEEK + 1)

    body = api_client.get(
        reverse("weekly_plan-grid"), {"year": YEAR, "week": WEEK}
    ).data

    days = {
        employee["short_name_for_weekly_plan"]: employee["absent_days"]
        for employee in body["employees"]
    }
    assert days == {"Anna": [1, 3], "Ben": []}


def test_a_new_shift_on_a_day_of_absence_is_refused(api_client, field, anna):
    _absent(anna, 2)

    response = _save(api_client, [_assignment(anna, field, 2)])

    assert response.status_code == status.HTTP_409_CONFLICT
    assert response.data["code"] == "staff.employee_absent"
    assert response.data["details"] == {"employee_id": anna.pk, "day": 2}
    assert not WeeklyPlan.objects.exists()


def test_a_shift_planned_before_the_absence_stays_saveable(api_client, field, anna):
    _plan(anna, field, 2)
    _absent(anna, 2)
    ben = Employee.objects.create(short_name_for_weekly_plan="Ben")

    # The office adds Ben on another day; Anna's earlier shift goes along.
    response = _save(
        api_client,
        [_assignment(anna, field, 2), _assignment(ben, field, 3)],
    )

    assert response.status_code == status.HTTP_200_OK, response.content
    assert WeeklyPlan.objects.filter(employee=anna, day=2).exists()


def test_moving_an_earlier_shift_keeps_it_on_its_day(api_client, field, anna):
    _plan(anna, field, 2, row_index=0)
    _absent(anna, 2)

    response = _save(api_client, [_assignment(anna, field, 2, row_index=1)])

    assert response.status_code == status.HTTP_200_OK, response.content


def test_an_earlier_shift_lets_in_no_second_one_that_day(api_client, field, anna):
    packing = WeeklyPlanCategory.objects.create(name="Packing", max_lines=3)
    _plan(anna, field, 2)
    _absent(anna, 2)

    response = _save(
        api_client,
        [_assignment(anna, field, 2), _assignment(anna, packing, 2)],
    )

    assert response.status_code == status.HTTP_409_CONFLICT
    assert response.data["code"] == "staff.employee_absent"
    assert WeeklyPlan.objects.filter(employee=anna).count() == 1


def test_a_copied_week_leaves_out_the_days_of_absence(api_client, field, anna):
    _plan(anna, field, 1, week=WEEK - 1)
    _plan(anna, field, 2, week=WEEK - 1)
    _absent(anna, 2)

    response = api_client.post(
        reverse("weekly_plan-copy"),
        {"year": YEAR, "from_week": WEEK - 1, "to_week": WEEK},
        format="json",
    )

    assert response.status_code == status.HTTP_200_OK, response.content
    assert list(WeeklyPlan.objects.filter(week=WEEK).values_list("day", flat=True)) == [
        1
    ]
