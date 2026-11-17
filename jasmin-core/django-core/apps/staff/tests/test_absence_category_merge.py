"""The data step of the migration that made absence categories hold for every
year: the categories of one name from several years become one, their absences
move to it, and the default category is there afterwards."""

from __future__ import annotations

import importlib

import pytest
from django.apps import apps as django_apps

from apps.staff.models import Absence, AbsenceCategory, Employee

pytestmark = pytest.mark.django_db

merge_years_and_seed_the_default = importlib.import_module(
    "apps.staff.migrations.0006_absencecategory_is_default_and_more"
)._merge_years_and_seed_the_default


@pytest.fixture()
def anna(tenant):
    # The schema's own migration has made the default already; start without.
    AbsenceCategory.objects.all().delete()
    return Employee.objects.create(short_name_for_weekly_plan="Anna")


def _category(name: str, year: int | None, *, is_active: bool = True):
    return AbsenceCategory.objects.create(name=name, year=year, is_active=is_active)


def _absent(employee, category, week: int) -> Absence:
    return Absence.objects.create(
        year=2031, week=week, day=0, employee=employee, absence_category=category
    )


def _names() -> list[tuple[str, bool]]:
    return sorted(AbsenceCategory.objects.values_list("name", "is_default"))


class TestMergingTheYears:
    def test_keeps_the_active_one_with_every_absence(self, anna):
        old = _category("Urlaub", 2030, is_active=False)
        current = _category("Urlaub", 2031)
        _absent(anna, old, week=3)
        _absent(anna, current, week=4)

        merge_years_and_seed_the_default(django_apps, None)

        kept = AbsenceCategory.objects.get(name="Urlaub")
        assert kept.pk == current.pk
        assert Absence.objects.filter(absence_category=kept).count() == 2

    def test_among_inactive_ones_keeps_the_latest_year(self, anna):
        _category("Kur", 2029, is_active=False)
        latest = _category("Kur", 2030, is_active=False)

        merge_years_and_seed_the_default(django_apps, None)

        assert AbsenceCategory.objects.get(name="Kur").pk == latest.pk

    def test_leaves_categories_of_other_names_alone(self, anna):
        _category("Urlaub", 2031)
        _category("Kur", 2031)

        merge_years_and_seed_the_default(django_apps, None)

        assert _names() == [("Abwesenheit", True), ("Kur", False), ("Urlaub", False)]


class TestTheDefault:
    def test_is_made_when_there_is_none(self, anna):
        merge_years_and_seed_the_default(django_apps, None)

        assert _names() == [("Abwesenheit", True)]

    def test_a_category_of_its_name_becomes_it_and_is_switched_on(self, anna):
        named = _category("Abwesenheit", 2030, is_active=False)

        merge_years_and_seed_the_default(django_apps, None)

        named.refresh_from_db()
        assert (named.is_default, named.is_active) == (True, True)
        assert AbsenceCategory.objects.count() == 1

    def test_a_second_run_changes_nothing(self, anna):
        _category("Urlaub", 2030)
        _category("Urlaub", 2031)
        merge_years_and_seed_the_default(django_apps, None)
        before = _names()

        merge_years_and_seed_the_default(django_apps, None)

        assert _names() == before
