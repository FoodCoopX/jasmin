"""The Saturday-shift page's backend. A Saturday shift is the employee's
Saturday row in the weekly plan: the year's shifts per employee, where a new one
is placed, what an absence and full categories refuse, what taking one away
removes — and that copying a week of the plan leaves the Saturday alone."""

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

# 2031 has 52 ISO weeks, 2026 has 53.
YEAR = 2031
WEEK = 10
WEDNESDAY = 2
SATURDAY = 5
YEAR_URL = "saturday_shifts-year"


def _employee(short_name: str, **fields) -> Employee:
    return Employee.objects.create(short_name_for_weekly_plan=short_name, **fields)


def _category(name: str, max_lines: int, **fields) -> WeeklyPlanCategory:
    return WeeklyPlanCategory.objects.create(name=name, max_lines=max_lines, **fields)


def _plan(employee, category, row_index, *, day=SATURDAY, week=WEEK):
    return WeeklyPlan.objects.create(
        year=YEAR,
        week=week,
        day=day,
        weekly_plan_category=category,
        employee=employee,
        row_index=row_index,
    )


def _absent_on_saturday(employee, week=WEEK):
    Absence.objects.create(
        year=YEAR,
        week=week,
        day=SATURDAY,
        employee=employee,
        absence_category=AbsenceCategory.default(),
    )


def _set(client, employee, on_duty=True, *, week=WEEK, year=YEAR):
    body = {"year": year, "week": week, "employee_id": employee.pk, "on_duty": on_duty}
    return client.post(reverse(YEAR_URL), body, format="json")


def _saturday_rows(week=WEEK):
    return sorted(
        WeeklyPlan.objects.filter(year=YEAR, week=week, day=SATURDAY).values_list(
            "employee__short_name_for_weekly_plan",
            "weekly_plan_category__name",
            "row_index",
        )
    )


class TestTheYear:
    def test_lists_the_saturdays_each_employee_works_and_is_absent_on(self, api_client):
        anna, ben = _employee("Anna"), _employee("Ben")
        field = _category("Field", 3)
        _plan(anna, field, 0, week=3)
        _plan(anna, field, 0, week=7)
        _plan(anna, field, 1, day=WEDNESDAY, week=4)
        _absent_on_saturday(ben, week=7)

        response = api_client.get(reverse(YEAR_URL), {"year": YEAR})

        assert response.status_code == status.HTTP_200_OK, response.content
        assert response.data["weeks"] == 52
        rows = {
            row["short_name_for_weekly_plan"]: row for row in response.data["employees"]
        }
        assert (rows["Anna"]["weeks"], rows["Anna"]["absent_weeks"]) == ([3, 7], [])
        assert (rows["Ben"]["weeks"], rows["Ben"]["absent_weeks"]) == ([], [7])

    def test_counts_the_weeks_of_a_long_year(self, api_client):
        response = api_client.get(reverse(YEAR_URL), {"year": 2026})

        assert response.data["weeks"] == 53

    def test_lists_an_inactive_employee_only_with_a_shift_that_year(self, api_client):
        field = _category("Field", 3)
        _employee("Gone", is_active=False)
        _plan(_employee("Left", is_active=False), field, 0)

        response = api_client.get(reverse(YEAR_URL), {"year": YEAR})

        names = [
            row["short_name_for_weekly_plan"] for row in response.data["employees"]
        ]
        assert names == ["Left"]

    def test_leaves_out_saturday_rows_the_weekly_plan_does_not_show(self, api_client):
        anna = _employee("Anna")
        _plan(anna, _category("Old", 3, is_active=False), 0, week=3)
        _plan(anna, _category("Field", 1), 2, week=4)

        response = api_client.get(reverse(YEAR_URL), {"year": YEAR})

        assert response.data["employees"][0]["weeks"] == []

    def test_needs_the_year(self, api_client):
        response = api_client.get(reverse(YEAR_URL))

        assert response.status_code == status.HTTP_400_BAD_REQUEST


class TestSettingAShift:
    def test_takes_the_first_free_row_of_the_category_with_the_most(self, api_client):
        _category("Packing", 2, sort_order=1)
        field = _category("Field", 4, sort_order=2)
        _plan(_employee("Ben"), field, 0)

        response = _set(api_client, _employee("Anna"))

        assert response.status_code == status.HTTP_200_OK, response.content
        assert _saturday_rows() == [("Anna", "Field", 1), ("Ben", "Field", 0)]

    def test_answers_with_the_year(self, api_client):
        _category("Field", 2)

        response = _set(api_client, _employee("Anna"))

        assert response.data["employees"][0]["weeks"] == [WEEK]

    def test_moves_on_to_the_next_largest_category_when_one_is_full(self, api_client):
        field = _category("Field", 2)
        _category("Packing", 1, sort_order=9)
        _category("Kitchen", 1, sort_order=1)
        _plan(_employee("Ben"), field, 0)
        _plan(_employee("Cleo"), field, 1)

        _set(api_client, _employee("Anna"))

        assert ("Anna", "Kitchen", 0) in _saturday_rows()

    def test_a_row_the_weekly_plan_does_not_show_is_no_shift(self, api_client):
        anna = _employee("Anna")
        _plan(anna, _category("Old", 3, is_active=False), 0)
        _category("Field", 2)

        response = _set(api_client, anna)

        assert response.status_code == status.HTTP_200_OK, response.content
        assert ("Anna", "Field", 0) in _saturday_rows()

    def test_refuses_a_deactivated_employee(self, api_client):
        _category("Field", 3)

        response = _set(api_client, _employee("Gone", is_active=False))

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data["code"] == "staff.employee_inactive"
        assert _saturday_rows() == []

    def test_a_held_shift_stays_on_an_absent_saturday(self, api_client):
        field = _category("Field", 3)
        anna = _employee("Anna")
        _plan(anna, field, 1)
        _absent_on_saturday(anna)

        response = _set(api_client, anna)

        assert response.status_code == status.HTTP_200_OK, response.content
        assert _saturday_rows() == [("Anna", "Field", 1)]

    def test_leaves_deactivated_categories_out(self, api_client):
        _category("Old", 9, is_active=False)
        _category("Field", 1)

        _set(api_client, _employee("Anna"))

        assert _saturday_rows() == [("Anna", "Field", 0)]

    def test_refuses_when_no_category_has_a_free_row(self, api_client):
        field = _category("Field", 1)
        _plan(_employee("Ben"), field, 0)

        response = _set(api_client, _employee("Anna"))

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data["code"] == "staff.saturday_shift_no_place"
        assert _saturday_rows() == [("Ben", "Field", 0)]

    def test_a_shift_the_employee_has_stays_the_one(self, api_client):
        field = _category("Field", 3)
        anna = _employee("Anna")
        _plan(anna, field, 2)

        response = _set(api_client, anna)

        assert response.status_code == status.HTTP_200_OK, response.content
        assert _saturday_rows() == [("Anna", "Field", 2)]

    def test_refuses_a_saturday_the_employee_is_absent_on(self, api_client):
        _category("Field", 3)
        anna = _employee("Anna")
        _absent_on_saturday(anna)

        response = _set(api_client, anna)

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data["code"] == "staff.employee_absent"
        assert _saturday_rows() == []

    def test_refuses_a_week_the_year_does_not_have(self, api_client):
        _category("Field", 3)

        response = _set(api_client, _employee("Anna"), week=53)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["code"] == "staff.invalid"

    def test_refuses_an_unknown_employee(self, api_client):
        body = {"year": YEAR, "week": WEEK, "employee_id": "nobody", "on_duty": True}

        response = api_client.post(reverse(YEAR_URL), body, format="json")

        assert response.status_code == status.HTTP_404_NOT_FOUND


class TestTakingAShiftAway:
    def test_removes_every_saturday_row_of_the_employee_that_week(self, api_client):
        field, packing = _category("Field", 3), _category("Packing", 3)
        anna, ben = _employee("Anna"), _employee("Ben")
        _plan(anna, field, 0)
        _plan(anna, packing, 0)
        _plan(ben, field, 1)
        wednesday = _plan(anna, field, 0, day=WEDNESDAY)
        next_saturday = _plan(anna, field, 0, week=WEEK + 1)

        response = _set(api_client, anna, on_duty=False)

        assert response.status_code == status.HTTP_200_OK, response.content
        assert _saturday_rows() == [("Ben", "Field", 1)]
        assert (
            WeeklyPlan.objects.filter(pk__in=[wednesday.pk, next_saturday.pk]).count()
            == 2
        )

    def test_a_shift_from_before_an_absence_shows_until_taken_away(self, api_client):
        field = _category("Field", 3)
        anna = _employee("Anna")
        _plan(anna, field, 0)
        _absent_on_saturday(anna)

        row = api_client.get(reverse(YEAR_URL), {"year": YEAR}).data["employees"][0]
        assert (row["weeks"], row["absent_weeks"]) == ([WEEK], [WEEK])

        response = _set(api_client, anna, on_duty=False)

        assert response.status_code == status.HTTP_200_OK, response.content
        assert _saturday_rows() == []

    def test_a_deactivated_employees_shift_can_be_taken_away(self, api_client):
        gone = _employee("Gone", is_active=False)
        _plan(gone, _category("Field", 3), 0)

        response = _set(api_client, gone, on_duty=False)

        assert response.status_code == status.HTTP_200_OK, response.content
        assert _saturday_rows() == []


class TestCopyingAWeekLeavesTheSaturdayAlone:
    def _copy(self, client, to_week=WEEK + 1):
        return client.post(
            reverse("weekly_plan-copy"),
            {"year": YEAR, "from_week": WEEK, "to_week": to_week},
            format="json",
        )

    def test_the_saturday_is_not_copied(self, api_client):
        field = _category("Field", 3)
        anna = _employee("Anna")
        _plan(anna, field, 0, day=0)
        _plan(anna, field, 0)

        response = self._copy(api_client)

        assert response.status_code == status.HTTP_200_OK, response.content
        copied = WeeklyPlan.objects.filter(year=YEAR, week=WEEK + 1)
        assert list(copied.values_list("day", flat=True)) == [0]

    def test_a_week_holding_only_saturday_shifts_counts_as_empty(self, api_client):
        field = _category("Field", 3)
        anna, ben = _employee("Anna"), _employee("Ben")
        _plan(anna, field, 0, day=0)
        _plan(ben, field, 0, week=WEEK + 1)

        response = self._copy(api_client)

        assert response.status_code == status.HTTP_200_OK, response.content
        assert sorted(
            WeeklyPlan.objects.filter(year=YEAR, week=WEEK + 1).values_list(
                "employee__short_name_for_weekly_plan", "day"
            )
        ) == [("Anna", 0), ("Ben", SATURDAY)]

    def test_a_week_with_other_days_planned_is_still_refused(self, api_client):
        field = _category("Field", 3)
        anna, ben = _employee("Anna"), _employee("Ben")
        _plan(anna, field, 0, day=0)
        _plan(ben, field, 0, day=WEDNESDAY, week=WEEK + 1)

        response = self._copy(api_client)

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data["code"] == "staff.weekly_plan_copy_target_not_empty"

    def test_a_saturday_row_the_grid_cannot_show_does_not_block(self, api_client):
        old = _category("Old", 3, is_active=False)
        small = _category("Field", 1)
        anna = _employee("Anna")
        _plan(anna, old, 0)
        _plan(anna, small, 2, week=WEEK)

        response = self._copy(api_client)

        assert response.status_code == status.HTTP_200_OK, response.content
