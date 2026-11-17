"""Employees and their absences from the tenant's HR system.

The sync keeps its own employees — the ones it added, marked
``comes_from_hr_system`` and carrying their ``hr_system_id`` — in step with the
HR system: a new one is added, one that is gone or locked there is deactivated
— never deleted, the weekly plans and absences keep pointing at it — and a
returning one is reactivated. Their names come from the HR system too, so an
edit made here is overwritten by the next sync. The employees entered in Jasmin
are left alone; only their weekly-plan names count, as names the sync's
employees must not take.

The tenant names the address of the employee list (``hr_system_employees_url``)
and a bearer token. The list is a JSON array of objects with ``id`` (string),
``firstName`` / ``lastName`` / ``name`` (strings or null) and ``active``
(boolean); an entry that isn't active is a locked account, which the sync
treats as gone. A list whose entries don't look like that is refused rather
than read as nobody.

A list cut short — read with a token that sees only one team, say — would
deactivate everyone it leaves out. So the sync refuses an empty list, and asks
before it deactivates more than half of its active employees
(``HrSystemMassDeactivation``); a farm whose season staff leave together
confirms and goes on.

The absence sync runs the employee sync first, then mirrors the approved
absences of the HR system's active employees (``hr_system_absences_url``: a
JSON array of objects with ``employeeId``, ``startDate`` and ``endDate`` as ISO
dates, and ``status``) into ``Absence`` rows, a row per day; a half day counts
as a whole one. Every one lands in the default category: the sync reads no
type, so a sick day arrives as a plain absence and Jasmin holds no health data.
One request fetches them all. The sync covers the ISO years from the last to
the next: older absences, and those of employees who left, stay as they were,
so the history survives the HR system forgetting them.

The addresses are tenant input the backend calls, so one whose host resolves
to an internal address is refused (``apps.shared.outbound_hosts``), and
redirects are not followed.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any
from urllib.parse import urlsplit

import requests
from django.db import transaction
from django.db.models import Exists, OuterRef
from django.utils import timezone

from apps.shared.iso_week_filters import iso_week_bound
from apps.shared.outbound_hosts import address_origin, resolves_to_internal_address
from apps.shared.tenants.models import Tenant
from core.db_locks import acquire_advisory_xact_lock

from ..errors import (
    HrSystemAddressNotAllowed,
    HrSystemMassDeactivation,
    HrSystemNotSetUp,
    HrSystemTokenRejected,
    HrSystemUnavailable,
)
from ..models import Absence, AbsenceCategory, Employee, WeeklyPlan

logger = logging.getLogger(__name__)

HR_SYSTEM_TIMEOUT_SECONDS = 15
# The max_length of ``Employee.short_name_for_weekly_plan`` and of its
# ``first_name`` / ``last_name``.
SHORT_NAME_MAX_LENGTH = 50
NAME_MAX_LENGTH = 200
# The max_length of ``Employee.hr_system_id``: a list holding a longer id is
# no list of employees Jasmin can keep.
HR_SYSTEM_ID_MAX_LENGTH = 64


@dataclass(frozen=True)
class HrSystemEmployee:
    hr_system_id: str
    first_name: str
    last_name: str


@dataclass(frozen=True)
class HrSystemSyncResult:
    created: int
    updated: int
    deactivated: int


@dataclass(frozen=True)
class HrSystemAbsence:
    hr_system_id: str
    start: date
    end: date


@dataclass(frozen=True)
class HrSystemAbsenceSyncResult:
    created: int
    updated: int
    deleted: int
    # Shifts planned from this week on that fall on an absence.
    conflicts: int


def sync_employees_from_hr_system(
    tenant: Tenant, *, confirm_deactivations: bool = False
) -> HrSystemSyncResult:
    if not (
        tenant.uses_hr_system
        and tenant.hr_system_employees_url
        and tenant.hr_system_api_token
    ):
        raise HrSystemNotSetUp(
            "Switch the HR system on and store its employee address and API "
            "token in the app settings."
        )
    people = fetch_hr_system_employees(
        tenant.hr_system_employees_url, tenant.hr_system_api_token
    )
    with transaction.atomic():
        # A second sync waits, then finds the employees this one adds.
        acquire_advisory_xact_lock("hr_system_sync")
        return _apply(people, confirm_deactivations=confirm_deactivations)


def sync_absences_from_hr_system(
    tenant: Tenant, *, confirm_deactivations: bool = False
) -> tuple[HrSystemSyncResult, HrSystemAbsenceSyncResult]:
    """Sync the employees, then their absences."""
    if not (
        tenant.uses_hr_system
        and tenant.hr_system_employees_url
        and tenant.hr_system_absences_url
        and tenant.hr_system_api_token
    ):
        raise HrSystemNotSetUp(
            "Switch the HR system on and store its employee and absence "
            "addresses and API token in the app settings."
        )
    if address_origin(tenant.hr_system_employees_url) != address_origin(
        tenant.hr_system_absences_url
    ):
        raise HrSystemAddressNotAllowed(
            "Both HR-system addresses must lead to the same server."
        )
    token = tenant.hr_system_api_token
    people = fetch_hr_system_employees(tenant.hr_system_employees_url, token)
    absences = fetch_hr_system_absences(tenant.hr_system_absences_url, token)
    with transaction.atomic():
        acquire_advisory_xact_lock("hr_system_sync")
        employees = _apply(people, confirm_deactivations=confirm_deactivations)
        return employees, _apply_absences(people, absences)


def fetch_hr_system_absences(url: str, token: str) -> list[HrSystemAbsence]:
    """The approved absences the HR system lists."""
    answer = _get(url, token)
    if not isinstance(answer, list) or not all(map(_is_absence, answer)):
        logger.warning("hr_system.bad_response host=%s", urlsplit(url).hostname)
        raise HrSystemUnavailable("The HR system sent no list of absences.")
    return [
        HrSystemAbsence(
            entry["employeeId"].strip(),
            date.fromisoformat(entry["startDate"]),
            date.fromisoformat(entry["endDate"]),
        )
        for entry in answer
        if entry["status"] == "approved"
    ]


def _is_absence(entry: Any) -> bool:
    if not isinstance(entry, dict) or not all(
        isinstance(entry.get(key), str)
        for key in ("employeeId", "startDate", "endDate", "status")
    ):
        return False
    try:
        start = date.fromisoformat(entry["startDate"])
        end = date.fromisoformat(entry["endDate"])
    except ValueError:
        return False
    return start <= end


def fetch_hr_system_employees(url: str, token: str) -> list[HrSystemEmployee]:
    """The employees the HR system lists as active."""
    answer = _get(url, token)
    # Any HR system lists at least the account the token belongs to, so an
    # empty list is no answer.
    if not isinstance(answer, list) or not answer or not all(map(_is_employee, answer)):
        logger.warning("hr_system.bad_response host=%s", urlsplit(url).hostname)
        raise HrSystemUnavailable("The HR system sent no list of employees.")

    employees: dict[str, HrSystemEmployee] = {}
    for entry in answer:
        hr_system_id = entry["id"].strip()
        if not entry["active"] or hr_system_id in employees:
            continue
        first_name = _name(entry.get("firstName"))
        last_name = _name(entry.get("lastName"))
        if not first_name and not last_name:
            first_name = _name(entry.get("name"))
        if first_name or last_name:
            employees[hr_system_id] = HrSystemEmployee(
                hr_system_id, first_name, last_name
            )
    return list(employees.values())


def _name(value: Any) -> str:
    # Text only: anything else in a name field is not a name, and its text
    # could carry more of the HR system's record than Jasmin keeps.
    if not isinstance(value, str):
        return ""
    return value.strip()[:NAME_MAX_LENGTH].rstrip()


def _is_employee(entry: Any) -> bool:
    return (
        isinstance(entry, dict)
        and isinstance(entry.get("id"), str)
        and 0 < len(entry["id"].strip()) <= HR_SYSTEM_ID_MAX_LENGTH
        and isinstance(entry.get("active"), bool)
    )


def _get(url: str, token: str) -> Any:
    """The JSON answer of a GET, the only request the sync ever sends."""
    address = urlsplit(url)
    host = address.hostname
    # Checked here too, not only when an address is saved: the token goes
    # along, and an address may reach the database by other ways.
    if address.scheme != "https":
        raise HrSystemAddressNotAllowed("The HR system's address must use https.")
    if resolves_to_internal_address(host):
        raise HrSystemAddressNotAllowed(
            "The HR system's address leads into an internal network."
        )
    try:
        response = requests.get(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
            timeout=HR_SYSTEM_TIMEOUT_SECONDS,
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        logger.warning(
            "hr_system.unreachable host=%s error=%s", host, exc.__class__.__name__
        )
        raise HrSystemUnavailable("The HR system could not be reached.") from exc

    if response.status_code in (401, 403):
        raise HrSystemTokenRejected("The HR system does not accept the token.")
    if response.status_code != 200:
        logger.warning(
            "hr_system.bad_status host=%s status=%s", host, response.status_code
        )
        raise HrSystemUnavailable(
            f"The HR system answered with HTTP {response.status_code}."
        )
    try:
        return response.json()
    except ValueError as exc:
        logger.warning("hr_system.bad_response host=%s", host)
        raise HrSystemUnavailable("The HR system's answer could not be read.") from exc


def _apply(
    people: list[HrSystemEmployee], *, confirm_deactivations: bool
) -> HrSystemSyncResult:
    employees = list(Employee.objects.all())
    synced = {row.hr_system_id: row for row in employees if row.hr_system_id}
    present = {person.hr_system_id for person in people}

    gone = [
        row
        for hr_system_id, row in synced.items()
        if row.is_active and hr_system_id not in present
    ]
    still_active = sum(1 for row in synced.values() if row.is_active)
    if len(gone) * 2 > still_active and not confirm_deactivations:
        raise HrSystemMassDeactivation(
            f"The sync would deactivate {len(gone)} of the {still_active} active "
            "employees it keeps.",
            details={
                "employees": sorted(row.short_name_for_weekly_plan for row in gone)
            },
        )

    # Names this sync doesn't hand out again: those of the employees entered in
    # Jasmin, and the last ones of those gone from the HR system.
    taken = {
        row.short_name_for_weekly_plan
        for row in employees
        if row.hr_system_id not in present
    }
    short_names = weekly_plan_short_names(people, taken)

    new_rows: list[Employee] = []
    changed_rows: list[Employee] = []
    for person in people:
        values = {
            "comes_from_hr_system": True,
            "first_name": person.first_name or None,
            "last_name": person.last_name or None,
            "short_name_for_weekly_plan": short_names[person.hr_system_id],
            "is_active": True,
        }
        row = synced.get(person.hr_system_id)
        if row is None:
            new_rows.append(Employee(hr_system_id=person.hr_system_id, **values))
        elif any(getattr(row, field) != value for field, value in values.items()):
            for field, value in values.items():
                setattr(row, field, value)
            changed_rows.append(row)

    Employee.objects.bulk_create(new_rows)
    Employee.objects.bulk_update(
        changed_rows,
        [
            "comes_from_hr_system",
            "first_name",
            "last_name",
            "short_name_for_weekly_plan",
            "is_active",
        ],
    )
    deactivated = Employee.objects.filter(pk__in=[row.pk for row in gone]).update(
        is_active=False
    )

    return HrSystemSyncResult(
        created=len(new_rows), updated=len(changed_rows), deactivated=deactivated
    )


def _apply_absences(
    people: list[HrSystemEmployee], absences: list[HrSystemAbsence]
) -> HrSystemAbsenceSyncResult:
    this_year = timezone.localdate().isocalendar().year
    first_year, last_year = this_year - 1, this_year + 1
    first_day = date.fromisocalendar(first_year, 1, 1)
    last_day = date.fromisocalendar(last_year + 1, 1, 1) - timedelta(days=1)
    employee_pks = dict(
        Employee.objects.filter(
            hr_system_id__in=[person.hr_system_id for person in people]
        ).values_list("hr_system_id", "pk")
    )
    wanted: set[tuple[str, int, int, int]] = set()
    for absence in absences:
        employee_pk = employee_pks.get(absence.hr_system_id)
        if employee_pk is None:
            continue
        day = max(absence.start, first_day)
        while day <= min(absence.end, last_day):
            iso_year, iso_week, iso_weekday = day.isocalendar()
            wanted.add((employee_pk, iso_year, iso_week, iso_weekday - 1))
            day += timedelta(days=1)

    stored = {
        (row.employee_id, row.year, row.week, row.day): row
        for row in Absence.objects.filter(
            employee_id__in=employee_pks.values(),
            year__gte=first_year,
            year__lte=last_year,
        )
    }
    new_rows: list[Absence] = []
    changed_rows: list[Absence] = []
    # Looked up, and made if missing, only when a day is to be filed.
    if wanted:
        default_pk: str = AbsenceCategory.default().pk
        new_rows = [
            Absence(
                employee_id=employee_pk,
                year=year,
                week=week,
                day=weekday,
                absence_category_id=default_pk,
            )
            for (employee_pk, year, week, weekday) in wanted
            if (employee_pk, year, week, weekday) not in stored
        ]
        for key, row in stored.items():
            if key in wanted and row.absence_category_id != default_pk:
                row.absence_category_id = default_pk
                changed_rows.append(row)
    gone_pks = [row.pk for key, row in stored.items() if key not in wanted]

    Absence.objects.bulk_create(new_rows)
    Absence.objects.bulk_update(changed_rows, ["absence_category"])
    Absence.objects.filter(pk__in=gone_pks).delete()

    return HrSystemAbsenceSyncResult(
        created=len(new_rows),
        updated=len(changed_rows),
        deleted=len(gone_pks),
        conflicts=_conflicts_from_this_week(),
    )


def _conflicts_from_this_week() -> int:
    this_week = timezone.localdate().isocalendar()
    return (
        WeeklyPlan.objects.filter(
            iso_week_bound((this_week.year, this_week.week), "gte", week_field="week")
        )
        .filter(
            Exists(
                Absence.objects.filter(
                    employee_id=OuterRef("employee_id"),
                    year=OuterRef("year"),
                    week=OuterRef("week"),
                    day=OuterRef("day"),
                )
            )
        )
        .count()
    )


def weekly_plan_short_names(
    people: Iterable[HrSystemEmployee], taken: Iterable[str]
) -> dict[str, str]:
    """Each person's name in the weekly plan, by HR-system id.

    The first name alone, followed by as many letters of the last name as it
    takes to tell apart people of the same first name — "Anna Mü" and
    "Anna Ma" next to "Ben". A name in ``taken`` — another employee's, active
    or not — counts as one more person to tell apart from. Where letters can't
    do it, the full name gets a number: "Anna Müller 2".
    """
    used = {name.casefold() for name in taken}
    groups: dict[str, list[HrSystemEmployee]] = defaultdict(list)
    for person in people:
        groups[(person.first_name or person.last_name).casefold()].append(person)

    names = {}
    for _, group in sorted(groups.items()):
        # Equal names are numbered in id order, numerically for numeric ids, so
        # the one the HR system has had longer keeps the plain name.
        group.sort(
            key=lambda person: (
                person.last_name.casefold(),
                len(person.hr_system_id),
                person.hr_system_id,
            )
        )
        for person in group:
            other_last_names = [
                other.last_name.casefold() for other in group if other is not person
            ]
            name = _short_name(person, other_last_names, used)
            used.add(name.casefold())
            names[person.hr_system_id] = name
    return names


def _short_name(
    person: HrSystemEmployee, other_last_names: list[str], used: set[str]
) -> str:
    if not person.first_name:
        base, last_name = person.last_name, ""
    else:
        base, last_name = person.first_name, person.last_name
    name = _fit(base)
    if not other_last_names and name.casefold() not in used:
        return name

    for length in range(1, len(last_name) + 1):
        prefix = last_name[:length]
        name = _fit(f"{base} {prefix}")
        shared = any(other.startswith(prefix.casefold()) for other in other_last_names)
        if not shared and name.casefold() not in used:
            return name

    full_name = _fit(f"{base} {last_name}")
    name, number = full_name, 1
    while name.casefold() in used:
        number += 1
        suffix = f" {number}"
        name = _fit(full_name, SHORT_NAME_MAX_LENGTH - len(suffix)) + suffix
    return name


def _fit(name: str, length: int = SHORT_NAME_MAX_LENGTH) -> str:
    return name[:length].rstrip()
