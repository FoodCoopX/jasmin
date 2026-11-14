"""The absence page's backend: the default category, the week of absences the
page shows, and one employee's week the office saves. The migration has made
the default category already."""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.commissioning.tests.factories import JasminUserFactory
from apps.staff.models import Absence, AbsenceCategory, Employee

pytestmark = pytest.mark.django_db

YEAR = 2031
WEEK = 10
WEEK_URL = "absences-week"


def _employee(short_name: str, **fields) -> Employee:
    return Employee.objects.create(short_name_for_weekly_plan=short_name, **fields)


def _absent(employee, category, day, week=WEEK):
    return Absence.objects.create(
        year=YEAR, week=week, day=day, employee=employee, absence_category=category
    )


def _save(client, employee, days, **overrides):
    body = {"year": YEAR, "week": WEEK, "employee_id": employee.pk, "days": days}
    return client.post(reverse(WEEK_URL), {**body, **overrides}, format="json")


class TestTheDefaultCategory:
    def test_there_is_one(self, tenant):
        first = AbsenceCategory.default()
        again = AbsenceCategory.default()

        assert first.pk == again.pk
        assert (first.name, first.is_default) == ("Abwesenheit", True)
        assert AbsenceCategory.objects.filter(is_default=True).count() == 1

    def test_one_is_made_when_there_is_none(self, tenant):
        AbsenceCategory.objects.filter(is_default=True).delete()

        default = AbsenceCategory.default()

        assert (default.name, default.is_default) == ("Abwesenheit", True)

    def test_a_category_already_named_so_becomes_it(self, tenant):
        AbsenceCategory.objects.filter(is_default=True).delete()
        named = AbsenceCategory.objects.create(name="Abwesenheit", is_active=False)

        default = AbsenceCategory.default()

        assert default.pk == named.pk
        named.refresh_from_db()
        assert (named.is_default, named.is_active) == (True, True)

    def test_it_can_be_renamed(self, api_client):
        default = AbsenceCategory.default()

        response = api_client.patch(
            reverse("absence_categories-detail", args=[default.pk]),
            {"name": "Abwesend", "is_active": True},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK, response.content
        default.refresh_from_db()
        assert default.name == "Abwesend"

    def test_it_cannot_be_switched_off(self, api_client):
        default = AbsenceCategory.default()

        response = api_client.patch(
            reverse("absence_categories-detail", args=[default.pk]),
            {"is_active": False},
            format="json",
        )

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data["code"] == "staff.absence_category_default_locked"
        assert response.data["field"] == "is_active"

    def test_it_cannot_be_deleted(self, api_client):
        default = AbsenceCategory.default()

        listed = api_client.get(reverse("absence_categories-list")).data
        response = api_client.delete(
            reverse("absence_categories-detail", args=[default.pk])
        )

        assert (
            next(row for row in listed if row["id"] == default.pk)["can_be_deleted"]
            is False
        )
        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data["code"] == "staff.absence_category_default_locked"
        assert AbsenceCategory.objects.filter(pk=default.pk).exists()


class TestTheWeek:
    def test_shows_each_active_employee_with_a_day_per_weekday(self, api_client):
        vacation = AbsenceCategory.objects.create(name="Urlaub")
        anna = _employee("Anna")
        _employee("Ben")
        _absent(anna, vacation, 0)
        _absent(anna, vacation, 1)
        _absent(anna, vacation, 1, week=WEEK + 1)

        body = api_client.get(reverse(WEEK_URL), {"year": YEAR, "week": WEEK}).data

        rows = {row["short_name_for_weekly_plan"]: row for row in body["employees"]}
        assert rows["Anna"]["days"] == {
            "0": vacation.pk,
            "1": vacation.pk,
            "2": None,
            "3": None,
            "4": None,
            "5": None,
            "6": None,
        }
        assert set(rows["Ben"]["days"].values()) == {None}
        assert rows["Anna"]["comes_from_hr_system"] is False

    def test_lists_an_inactive_employee_only_while_they_have_an_absence(
        self, api_client
    ):
        vacation = AbsenceCategory.objects.create(name="Urlaub")
        gone = _employee("Gone", is_active=False)
        _employee("Away", is_active=False)
        _absent(gone, vacation, 2)

        body = api_client.get(reverse(WEEK_URL), {"year": YEAR, "week": WEEK}).data

        names = {row["short_name_for_weekly_plan"] for row in body["employees"]}
        assert "Gone" in names
        assert "Away" not in names

    def test_offers_every_category_inactive_ones_too(self, api_client):
        AbsenceCategory.objects.create(name="Urlaub")
        AbsenceCategory.objects.create(name="Krank", is_active=False)

        body = api_client.get(reverse(WEEK_URL), {"year": YEAR, "week": WEEK}).data

        assert [
            (category["name"], category["is_active"], category["is_default"])
            for category in body["categories"]
        ] == [
            ("Abwesenheit", True, True),
            ("Krank", False, False),
            ("Urlaub", True, False),
        ]

    def test_any_staff_role_may_read_it(self, tenant):
        client = APIClient()
        client.force_authenticate(user=JasminUserFactory(roles=["gardener"]))

        response = client.get(reverse(WEEK_URL), {"year": YEAR, "week": WEEK})

        assert response.status_code == status.HTTP_200_OK


class TestSavingAnEmployeesWeek:
    def test_replaces_the_employees_absences_in_the_week(self, api_client):
        vacation = AbsenceCategory.objects.create(name="Urlaub")
        sick = AbsenceCategory.objects.create(name="Krank")
        anna = _employee("Anna")
        _absent(anna, vacation, 0)
        _absent(anna, vacation, 0, week=WEEK + 1)

        response = _save(api_client, anna, {"0": None, "2": sick.pk, "3": vacation.pk})

        assert response.status_code == status.HTTP_200_OK, response.content
        assert sorted(
            Absence.objects.filter(employee=anna, week=WEEK).values_list(
                "day", "absence_category__name"
            )
        ) == [(2, "Krank"), (3, "Urlaub")]
        assert Absence.objects.filter(employee=anna, week=WEEK + 1).count() == 1
        row = next(row for row in response.data["employees"] if row["id"] == anna.pk)
        assert row["days"]["2"] == sick.pk

    def test_refuses_an_hr_system_employee_while_the_tenant_uses_it(
        self, api_client, tenant
    ):
        tenant.uses_hr_system = True
        tenant.save()
        vacation = AbsenceCategory.objects.create(name="Urlaub")
        synced = Employee.objects.create(
            short_name_for_weekly_plan="Dora",
            comes_from_hr_system=True,
            hr_system_id="hr-1",
        )

        response = _save(api_client, synced, {"0": vacation.pk})

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data["code"] == "staff.absences_from_hr_system"
        assert not Absence.objects.filter(employee=synced).exists()

    def test_takes_an_hr_system_employee_once_the_tenant_no_longer_uses_it(
        self, api_client, tenant
    ):
        vacation = AbsenceCategory.objects.create(name="Urlaub")
        synced = Employee.objects.create(
            short_name_for_weekly_plan="Dora",
            comes_from_hr_system=True,
            hr_system_id="hr-1",
        )

        response = _save(api_client, synced, {"0": vacation.pk})

        assert response.status_code == status.HTTP_200_OK, response.content

    def test_refuses_an_unknown_category(self, api_client):
        anna = _employee("Anna")

        response = _save(api_client, anna, {"0": "nope"})

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert response.data["code"] == "staff.absence_category_not_found"

    def test_refuses_an_unknown_employee(self, api_client):
        response = api_client.post(
            reverse(WEEK_URL),
            {"year": YEAR, "week": WEEK, "employee_id": "nope", "days": {}},
            format="json",
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert response.data["code"] == "staff.employee_not_found"

    def test_refuses_a_day_that_is_no_weekday(self, api_client):
        anna = _employee("Anna")

        response = _save(api_client, anna, {"7": None})

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["code"] == "staff.invalid"

    @pytest.mark.parametrize("roles", [["gardener"], ["staff"]])
    def test_only_the_office_may_save(self, tenant, roles):
        client = APIClient()
        client.force_authenticate(user=JasminUserFactory(roles=roles))
        anna = _employee("Anna")

        response = _save(client, anna, {})

        assert response.status_code == status.HTTP_403_FORBIDDEN
