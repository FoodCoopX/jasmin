"""The data step of the migration that dropped employments: an employee without
weekly hours takes those of their latest employment, and the employments go."""

from __future__ import annotations

import importlib
from datetime import date
from decimal import Decimal

import pytest
from django.apps import apps as django_apps
from django.db import connection
from django.db.migrations.loader import MigrationLoader

from apps.staff.models import Employee

pytestmark = pytest.mark.django_db

hours_from_the_latest_employment = importlib.import_module(
    "apps.staff.migrations.0007_employee_hours_per_week_delete_employment"
)._hours_from_the_latest_employment


class _MigrationApps:
    """The models as the data step sees them: the current Employee, which has
    the weekly hours, beside Employment as it was before it went."""

    def __init__(self, employment):
        self.employment = employment

    def get_model(self, app_label: str, model_name: str):
        if model_name == "Employment":
            return self.employment
        return django_apps.get_model(app_label, model_name)


@pytest.fixture()
def employment(tenant):
    state = MigrationLoader(connection).project_state(
        ("staff", "0006_absencecategory_is_default_and_more")
    )
    return state.apps.get_model("staff", "Employment")


def _employed(employment, employee, valid_from: date, hours: str):
    employment.objects.create(
        employee_id=employee.pk, valid_from=valid_from, hours_per_week=Decimal(hours)
    )


class TestTheHoursFromTheLatestEmployment:
    def test_rounds_those_of_the_latest_to_whole_hours(self, employment):
        anna = Employee.objects.create(short_name_for_weekly_plan="Anna")
        _employed(employment, anna, date(2026, 1, 5), "30.50")
        _employed(employment, anna, date(2025, 1, 6), "20.00")

        hours_from_the_latest_employment(_MigrationApps(employment), None)

        anna.refresh_from_db()
        assert anna.hours_per_week == 31

    def test_keeps_hours_already_set(self, employment):
        ben = Employee.objects.create(
            short_name_for_weekly_plan="Ben", hours_per_week=24
        )
        _employed(employment, ben, date(2026, 1, 5), "10.00")

        hours_from_the_latest_employment(_MigrationApps(employment), None)

        ben.refresh_from_db()
        assert ben.hours_per_week == 24

    def test_leaves_no_employment_behind(self, employment):
        clara = Employee.objects.create(short_name_for_weekly_plan="Clara")
        _employed(employment, clara, date(2026, 1, 5), "16.00")

        hours_from_the_latest_employment(_MigrationApps(employment), None)

        assert not employment.objects.exists()
        assert Employee.objects.filter(pk=clara.pk).exists()
