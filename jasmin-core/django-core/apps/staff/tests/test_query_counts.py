"""N+1 locks for the staff endpoints: each runs once with a few rows and once
with many, and must not need more queries the second time. A failure means a
query landed in a loop — a related object read per row, a write per row."""

from __future__ import annotations

import datetime
from unittest.mock import MagicMock, patch

import pytest
import time_machine
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from apps.staff.models import (
    Absence,
    AbsenceCategory,
    Employee,
    WeeklyPlan,
    WeeklyPlanCategory,
)

pytestmark = pytest.mark.django_db

YEAR = 2026
WEEK = 20


def _queries(call) -> int:
    with CaptureQueriesContext(connection) as context:
        response = call()
    assert response.status_code < 300, response.content[:300]
    return len(context.captured_queries)


def _employees(count: int, prefix: str) -> list[Employee]:
    return [
        Employee.objects.create(short_name_for_weekly_plan=f"{prefix}{index}")
        for index in range(count)
    ]


def _plan(employees: list[Employee], category: WeeklyPlanCategory, week: int):
    for index, employee in enumerate(employees):
        WeeklyPlan.objects.create(
            year=YEAR,
            week=week,
            day=index % 7,
            weekly_plan_category=category,
            employee=employee,
            row_index=index // 7,
        )


class TestListsStayFlat:
    """Every row of a list carries ``can_be_deleted``, which asks for the rows
    that still point at it."""

    def test_employees(self, api_client):
        category = WeeklyPlanCategory.objects.create(name="Field", max_lines=10)
        _plan(_employees(2, "few"), category, WEEK)
        few = _queries(lambda: api_client.get(reverse("employees-list")))

        _plan(_employees(20, "many"), category, WEEK + 1)
        many = _queries(lambda: api_client.get(reverse("employees-list")))

        assert many == few

    def test_weekly_plan_categories(self, api_client):
        WeeklyPlanCategory.objects.create(name="Field 0", max_lines=1)
        url = reverse("weekly_plan_categories-list")
        few = _queries(lambda: api_client.get(url))

        for index in range(1, 15):
            WeeklyPlanCategory.objects.create(name=f"Field {index}", max_lines=1)
        many = _queries(lambda: api_client.get(url))

        assert many == few

    def test_absence_categories(self, api_client):
        AbsenceCategory.objects.create(name="Vacation 0")
        url = reverse("absence_categories-list")
        few = _queries(lambda: api_client.get(url))

        for index in range(1, 15):
            AbsenceCategory.objects.create(name=f"Vacation {index}")
        many = _queries(lambda: api_client.get(url))

        assert many == few


class TestWeeklyPlanStaysFlat:
    def test_the_grid(self, api_client):
        url = reverse("weekly_plan-grid")
        params = {"year": YEAR, "week": WEEK}
        field = WeeklyPlanCategory.objects.create(name="Field", max_lines=10)
        _plan(_employees(2, "few"), field, WEEK)
        few = _queries(lambda: api_client.get(url, params))

        barn = WeeklyPlanCategory.objects.create(name="Barn", max_lines=10)
        _plan(_employees(30, "many"), barn, WEEK)
        many = _queries(lambda: api_client.get(url, params))

        assert many == few

    def test_saving_a_week(self, api_client):
        category = WeeklyPlanCategory.objects.create(name="Field", max_lines=10)
        employees = _employees(40, "e")

        def save(count):
            assignments = [
                {
                    "category_id": category.id,
                    "row_index": index // 7,
                    "day": index % 7,
                    "employee_id": employees[index].id,
                }
                for index in range(count)
            ]
            return api_client.post(
                reverse("weekly_plan-list"),
                {"year": YEAR, "week": WEEK, "assignments": assignments},
                format="json",
            )

        # Both measured saves replace a week that already holds rows.
        save(2)
        few = _queries(lambda: save(2))
        many = _queries(lambda: save(40))

        assert many == few

    def test_copying_a_week(self, api_client):
        category = WeeklyPlanCategory.objects.create(name="Field", max_lines=10)
        url = reverse("weekly_plan-copy")
        _plan(_employees(2, "few"), category, WEEK)
        few = _queries(
            lambda: api_client.post(
                url, {"year": YEAR, "from_week": WEEK, "to_week": 30}, format="json"
            )
        )

        _plan(_employees(40, "many"), category, WEEK + 1)
        many = _queries(
            lambda: api_client.post(
                url, {"year": YEAR, "from_week": WEEK + 1, "to_week": 31}, format="json"
            )
        )

        assert many == few


class TestHrSystemSyncStaysFlat:
    @pytest.fixture(autouse=True)
    def _hr_system(self, tenant):
        tenant.uses_hr_system = True
        tenant.hr_system_employees_url = "https://hr.example.com/api/employees"
        tenant.hr_system_api_token = "hr-secret"
        tenant.save()
        with patch(
            "apps.staff.services.hr_system.resolves_to_internal_address",
            return_value=False,
        ):
            yield

    def _sync(self, api_client, people):
        answer = MagicMock(status_code=200)
        answer.json.return_value = [
            {"id": hr_system_id, "firstName": first, "lastName": "Doe", "active": True}
            for hr_system_id, first in people
        ]
        with patch("apps.staff.services.hr_system.requests.get", return_value=answer):
            return api_client.post(reverse("employees-sync-from-hr-system"))

    def test_adding(self, api_client):
        first_people = [("a1", "Ann"), ("a2", "Bo")]
        few = _queries(lambda: self._sync(api_client, first_people))

        many_people = [(f"b{index}", f"Name{index}") for index in range(30)]
        many = _queries(lambda: self._sync(api_client, first_people + many_people))

        assert many == few

    def test_renaming(self, api_client):
        few_people = [("a1", "Ann"), ("a2", "Bo")]
        many_people = [(f"b{index}", f"Name{index}") for index in range(30)]
        self._sync(api_client, few_people + many_people)

        few = _queries(
            lambda: self._sync(
                api_client,
                [(hr_system_id, f"New{first}") for hr_system_id, first in few_people]
                + many_people,
            )
        )
        many = _queries(
            lambda: self._sync(
                api_client,
                [(hr_system_id, f"Old{first}") for hr_system_id, first in few_people]
                + [
                    (hr_system_id, f"New{first}") for hr_system_id, first in many_people
                ],
            )
        )

        assert many == few


class TestAbsencesStayFlat:
    def test_the_week(self, api_client):
        url = reverse("absences-week")
        params = {"year": YEAR, "week": WEEK}
        category = AbsenceCategory.default()
        for employee in _employees(2, "few"):
            _absent(employee, category)
        few = _queries(lambda: api_client.get(url, params))

        for employee in _employees(30, "many"):
            _absent(employee, category)
        many = _queries(lambda: api_client.get(url, params))

        assert many == few

    def test_saving_an_employees_week(self, api_client):
        category = AbsenceCategory.default()
        (anna,) = _employees(1, "anna")

        def save(day_count):
            days = {str(day): category.pk for day in range(day_count)}
            body = {"year": YEAR, "week": WEEK, "employee_id": anna.pk, "days": days}
            return api_client.post(reverse("absences-week"), body, format="json")

        save(1)
        few = _queries(lambda: save(1))
        many = _queries(lambda: save(7))

        assert many == few


def _absent(employee, category, week=WEEK):
    Absence.objects.create(
        year=YEAR, week=week, day=0, employee=employee, absence_category=category
    )


class TestSaturdayShiftsStayFlat:
    def test_the_year(self, api_client):
        url = reverse("saturday_shifts-year")
        field = WeeklyPlanCategory.objects.create(name="Field", max_lines=60)
        absence = AbsenceCategory.default()

        def give_saturdays(employees, first_row):
            for index, employee in enumerate(employees, start=first_row):
                for week in (WEEK, WEEK + 1):
                    WeeklyPlan.objects.create(
                        year=YEAR,
                        week=week,
                        day=5,
                        weekly_plan_category=field,
                        employee=employee,
                        row_index=index,
                    )
                Absence.objects.create(
                    year=YEAR,
                    week=WEEK + 2,
                    day=5,
                    employee=employee,
                    absence_category=absence,
                )

        give_saturdays(_employees(2, "few"), first_row=0)
        few = _queries(lambda: api_client.get(url, {"year": YEAR}))
        give_saturdays(_employees(30, "many"), first_row=2)
        many = _queries(lambda: api_client.get(url, {"year": YEAR}))

        assert many == few

    def test_setting_one(self, api_client):
        url = reverse("saturday_shifts-year")
        for index in range(5):
            WeeklyPlanCategory.objects.create(name=f"Field {index}", max_lines=3)
        employees = _employees(16, "e")

        def give(employee, week):
            body = {
                "year": YEAR,
                "week": week,
                "employee_id": employee.pk,
                "on_duty": True,
            }
            return api_client.post(url, body, format="json")

        give(employees[0], WEEK)
        few = _queries(lambda: give(employees[1], WEEK))
        # Twelve rows taken: the next one sits in the fifth category.
        for employee in employees[2:14]:
            give(employee, WEEK)
        many = _queries(lambda: give(employees[14], WEEK))

        assert many == few


class TestHrSystemAbsenceSyncStaysFlat:
    """Each measured sync moves, adds and removes a day for each of its people."""

    PEOPLE = [
        {
            "id": f"p{index}",
            "firstName": f"Name{index}",
            "lastName": "Doe",
            "active": True,
        }
        for index in range(10)
    ]

    @pytest.fixture(autouse=True)
    def _hr_system(self, tenant):
        tenant.uses_hr_system = True
        tenant.hr_system_employees_url = "https://hr.example.com/api/employees"
        tenant.hr_system_absences_url = "https://hr.example.com/api/absences"
        tenant.hr_system_api_token = "hr-secret"
        tenant.save()
        with (
            patch(
                "apps.staff.services.hr_system.resolves_to_internal_address",
                return_value=False,
            ),
            time_machine.travel(datetime.datetime(2026, 4, 6, 12, 0), tick=False),
        ):
            yield

    def _sync(self, api_client, absences):
        answers = {
            "https://hr.example.com/api/employees": MagicMock(status_code=200),
            "https://hr.example.com/api/absences": MagicMock(status_code=200),
        }
        answers["https://hr.example.com/api/employees"].json.return_value = self.PEOPLE
        answers["https://hr.example.com/api/absences"].json.return_value = absences
        with patch(
            "apps.staff.services.hr_system.requests.get",
            side_effect=lambda url, **kwargs: answers[url],
        ):
            return api_client.post(reverse("absences-sync-from-hr-system"))

    def _changing(self, api_client, count):
        # Each employee's Monday moves into the default, the Tuesday goes and
        # the Wednesday comes.
        Absence.objects.all().delete()
        other = AbsenceCategory.objects.get(name="Other")
        for employee in Employee.objects.filter(
            hr_system_id__in=[f"p{i}" for i in range(count)]
        ):
            for day in (0, 1):
                Absence.objects.create(
                    year=2026,
                    week=15,
                    day=day,
                    employee=employee,
                    absence_category=other,
                )
        absences = [
            {
                "employeeId": f"p{index}",
                "type": "URL",
                "startDate": start,
                "endDate": start,
                "status": "approved",
            }
            for index in range(count)
            for start in ("2026-04-06", "2026-04-08")
        ]
        return _queries(lambda: self._sync(api_client, absences))

    def test_absences(self, api_client):
        AbsenceCategory.objects.create(name="Other")
        self._sync(api_client, [])

        assert self._changing(api_client, 10) == self._changing(api_client, 1)
