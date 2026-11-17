"""The HR-system sync of the absences: which absences become days of absence,
all in the default category, what it changes and leaves alone, and what it
reports. The HR system answers from canned responses, its host resolves to a
public address, and the clock stands on Monday of ISO week 15 of 2026, so the
sync covers the ISO years 2025 to 2027."""

from __future__ import annotations

import datetime
from unittest.mock import MagicMock, patch

import pytest
import time_machine
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

EMPLOYEES_URL = "https://hr.example.com/api/employees"
ABSENCES_URL = "https://hr.example.com/api/absences"
SYNC_URL = "absences-sync-from-hr-system"


@pytest.fixture(autouse=True)
def _monday_of_week_15():
    with time_machine.travel(datetime.datetime(2026, 4, 6, 12, 0), tick=False):
        yield


@pytest.fixture(autouse=True)
def _public_hosts():
    with patch(
        "apps.staff.services.hr_system.resolves_to_internal_address",
        return_value=False,
    ):
        yield


@pytest.fixture()
def hr_system_tenant(tenant):
    tenant.uses_hr_system = True
    tenant.hr_system_employees_url = EMPLOYEES_URL
    tenant.hr_system_absences_url = ABSENCES_URL
    tenant.hr_system_api_token = "hr-secret"
    tenant.save()
    return tenant


def _person(hr_system_id, first_name):
    return {
        "id": hr_system_id,
        "firstName": first_name,
        "lastName": "Doe",
        "active": True,
    }


def _absence(hr_system_id, start, end, type_="URL", status_="approved", **extra):
    return {
        "employeeId": hr_system_id,
        "type": type_,
        "startDate": start,
        "endDate": end,
        "status": status_,
        **extra,
    }


PEOPLE = [_person("hr-1", "Anna"), _person("hr-2", "Ben")]


def _answer(payload, status_code=200):
    response = MagicMock(status_code=status_code)
    response.json.return_value = payload
    return response


def _sync(client, absences, people=PEOPLE, **body):
    answers = {EMPLOYEES_URL: _answer(people), ABSENCES_URL: _answer(absences)}
    with patch(
        "apps.staff.services.hr_system.requests.get",
        side_effect=lambda url, **kwargs: answers[url],
    ):
        return client.post(reverse(SYNC_URL), body, format="json")


def _days(hr_system_id):
    return sorted(
        Absence.objects.filter(employee__hr_system_id=hr_system_id).values_list(
            "year", "week", "day", "absence_category__name"
        )
    )


class TestWhatBecomesAnAbsence:
    def test_each_day_of_an_approved_absence(self, api_client, hr_system_tenant):
        response = _sync(api_client, [_absence("hr-1", "2026-04-08", "2026-04-10")])

        assert response.status_code == status.HTTP_200_OK, response.content
        assert _days("hr-1") == [
            (2026, 15, 2, "Abwesenheit"),
            (2026, 15, 3, "Abwesenheit"),
            (2026, 15, 4, "Abwesenheit"),
        ]
        assert response.data["absences"] == {
            "created": 3,
            "updated": 0,
            "deleted": 0,
            "conflicts": 0,
        }
        assert response.data["employees"]["created"] == 2

    @pytest.mark.parametrize("status_", ["pending", "rejected"])
    def test_not_one_that_is_not_approved(self, api_client, hr_system_tenant, status_):
        _sync(
            api_client,
            [_absence("hr-1", "2026-04-08", "2026-04-08", status_=status_)],
        )

        assert _days("hr-1") == []

    def test_a_half_day_as_a_whole_one(self, api_client, hr_system_tenant):
        _sync(
            api_client,
            [_absence("hr-1", "2026-04-08", "2026-04-08", halfDay="morning")],
        )

        assert _days("hr-1") == [(2026, 15, 2, "Abwesenheit")]

    def test_days_by_their_iso_week_across_the_new_year(
        self, api_client, hr_system_tenant
    ):
        _sync(api_client, [_absence("hr-1", "2026-12-31", "2027-01-01")])

        assert _days("hr-1") == [
            (2026, 53, 3, "Abwesenheit"),
            (2026, 53, 4, "Abwesenheit"),
        ]

    def test_only_days_from_last_iso_year_to_the_next(
        self, api_client, hr_system_tenant
    ):
        _sync(
            api_client,
            [
                _absence("hr-1", "2024-12-27", "2024-12-31"),
                _absence("hr-1", "2027-12-31", "2028-01-04"),
            ],
        )

        assert _days("hr-1") == [
            (2025, 1, 0, "Abwesenheit"),
            (2025, 1, 1, "Abwesenheit"),
            (2027, 52, 4, "Abwesenheit"),
            (2027, 52, 5, "Abwesenheit"),
            (2027, 52, 6, "Abwesenheit"),
        ]

    def test_a_day_two_absences_share_once(self, api_client, hr_system_tenant):
        response = _sync(
            api_client,
            [
                _absence("hr-1", "2026-04-07", "2026-04-08", type_="KRA"),
                _absence("hr-1", "2026-04-06", "2026-04-07"),
            ],
        )

        assert response.status_code == status.HTTP_200_OK, response.content
        assert _days("hr-1") == [
            (2026, 15, 0, "Abwesenheit"),
            (2026, 15, 1, "Abwesenheit"),
            (2026, 15, 2, "Abwesenheit"),
        ]

    def test_nothing_for_someone_the_employee_list_leaves_out(
        self, api_client, hr_system_tenant
    ):
        _sync(api_client, [_absence("hr-9", "2026-04-08", "2026-04-08")])

        assert not Absence.objects.exists()


class TestCategories:
    @pytest.mark.parametrize("type_", ["KRA", "Krankheit", "URL"])
    def test_every_absence_lands_in_the_default_whatever_its_type(
        self, api_client, hr_system_tenant, type_
    ):
        for name in ("KRA", "Krankheit", "URL"):
            AbsenceCategory.objects.create(name=name)

        _sync(api_client, [_absence("hr-1", "2026-04-08", "2026-04-08", type_=type_)])

        assert _days("hr-1") == [(2026, 15, 2, "Abwesenheit")]

    def test_an_absence_without_a_type(self, api_client, hr_system_tenant):
        absence = _absence("hr-1", "2026-04-08", "2026-04-08")
        del absence["type"]

        response = _sync(api_client, [absence])

        assert response.status_code == status.HTTP_200_OK, response.content
        assert _days("hr-1") == [(2026, 15, 2, "Abwesenheit")]

    def test_makes_the_default_when_there_is_none(self, api_client, hr_system_tenant):
        AbsenceCategory.objects.filter(is_default=True).delete()

        _sync(api_client, [_absence("hr-1", "2026-04-08", "2026-04-08")])

        assert _days("hr-1") == [(2026, 15, 2, "Abwesenheit")]
        assert AbsenceCategory.objects.get(is_default=True).name == "Abwesenheit"


class TestWhatChanges:
    def test_moves_a_synced_day_into_the_default(self, api_client, hr_system_tenant):
        _sync(api_client, [])
        Absence.objects.create(
            year=2026,
            week=15,
            day=2,
            employee=Employee.objects.get(hr_system_id="hr-1"),
            absence_category=AbsenceCategory.objects.create(name="Krankheit"),
        )

        response = _sync(api_client, [_absence("hr-1", "2026-04-08", "2026-04-08")])

        assert response.data["absences"]["updated"] == 1
        assert _days("hr-1") == [(2026, 15, 2, "Abwesenheit")]

    def test_removes_a_day_the_hr_system_no_longer_has(
        self, api_client, hr_system_tenant
    ):
        _sync(api_client, [_absence("hr-1", "2026-04-08", "2026-04-09")])

        response = _sync(api_client, [_absence("hr-1", "2026-04-08", "2026-04-08")])

        assert response.data["absences"]["deleted"] == 1
        assert _days("hr-1") == [(2026, 15, 2, "Abwesenheit")]

    def test_keeps_history_from_before_last_year(self, api_client, hr_system_tenant):
        _sync(api_client, [])
        anna = Employee.objects.get(hr_system_id="hr-1")
        old = Absence.objects.create(
            year=2024,
            week=20,
            day=0,
            employee=anna,
            absence_category=AbsenceCategory.default(),
        )

        _sync(api_client, [])

        assert Absence.objects.filter(pk=old.pk).exists()

    def test_keeps_the_absences_of_someone_who_left(self, api_client, hr_system_tenant):
        _sync(
            api_client,
            [_absence("hr-2", "2026-04-08", "2026-04-08")],
            people=[
                _person("hr-1", "Anna"),
                _person("hr-2", "Ben"),
                _person("hr-3", "Carla"),
            ],
        )

        _sync(
            api_client, [], people=[_person("hr-1", "Anna"), _person("hr-3", "Carla")]
        )

        assert _days("hr-2") == [(2026, 15, 2, "Abwesenheit")]

    def test_leaves_the_absences_of_employees_entered_in_jasmin(
        self, api_client, hr_system_tenant
    ):
        intern = Employee.objects.create(short_name_for_weekly_plan="Pia")
        Absence.objects.create(
            year=2026,
            week=15,
            day=0,
            employee=intern,
            absence_category=AbsenceCategory.default(),
        )

        _sync(api_client, [])

        assert Absence.objects.filter(employee=intern).count() == 1

    def test_counts_planned_shifts_that_now_fall_on_an_absence(
        self, api_client, hr_system_tenant
    ):
        _sync(api_client, [])
        anna = Employee.objects.get(hr_system_id="hr-1")
        field = WeeklyPlanCategory.objects.create(name="Field", max_lines=2)
        for week in (14, 15, 16):
            WeeklyPlan.objects.create(
                year=2026,
                week=week,
                day=2,
                weekly_plan_category=field,
                employee=anna,
                row_index=0,
            )

        response = _sync(
            api_client,
            [
                _absence("hr-1", "2026-04-01", "2026-04-01"),
                _absence("hr-1", "2026-04-08", "2026-04-08"),
                _absence("hr-1", "2026-04-15", "2026-04-15"),
            ],
        )

        # Week 14 is past; weeks 15 and 16 still count.
        assert response.data["absences"]["conflicts"] == 2
        assert WeeklyPlan.objects.filter(employee=anna).count() == 3


class TestRefusals:
    def test_without_an_absence_address(self, api_client, hr_system_tenant):
        hr_system_tenant.hr_system_absences_url = ""
        hr_system_tenant.save()

        with patch("apps.staff.services.hr_system.requests.get") as get:
            response = api_client.post(reverse(SYNC_URL))

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data["code"] == "staff.hr_system_not_set_up"
        get.assert_not_called()

    def test_with_the_addresses_on_two_servers(self, api_client, hr_system_tenant):
        """The token would go to both."""
        hr_system_tenant.hr_system_absences_url = (
            "https://elsewhere.example.net/api/absences"
        )
        hr_system_tenant.save()

        with patch("apps.staff.services.hr_system.requests.get") as get:
            response = api_client.post(reverse(SYNC_URL))

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data["code"] == "staff.hr_system_address_not_allowed"
        get.assert_not_called()

    @pytest.mark.parametrize(
        "absences",
        [
            {"error": "maintenance"},
            [{"employeeId": "hr-1", "type": "URL", "startDate": "2026-04-08"}],
            [_absence("hr-1", "2026-04-08", "08.04.2026")],
            [_absence("hr-1", "2026-04-09", "2026-04-08")],
            [_absence(7, "2026-04-08", "2026-04-08")],
        ],
    )
    def test_an_answer_that_is_not_a_list_of_absences(
        self, api_client, hr_system_tenant, absences
    ):
        _sync(api_client, [_absence("hr-1", "2026-04-08", "2026-04-08")])

        response = _sync(api_client, absences)

        assert response.status_code == status.HTTP_502_BAD_GATEWAY
        assert response.data["code"] == "staff.hr_system_unavailable"
        assert _days("hr-1") == [(2026, 15, 2, "Abwesenheit")]

    def test_asks_before_deactivating_more_than_half_of_the_employees(
        self, api_client, hr_system_tenant
    ):
        _sync(api_client, [])

        response = _sync(api_client, [], people=[_person("hr-3", "Carla")])
        confirmed = _sync(
            api_client,
            [],
            people=[_person("hr-3", "Carla")],
            confirm_deactivations=True,
        )

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data["code"] == "staff.hr_system_mass_deactivation"
        assert confirmed.status_code == status.HTTP_200_OK
        assert confirmed.data["employees"]["deactivated"] == 2
