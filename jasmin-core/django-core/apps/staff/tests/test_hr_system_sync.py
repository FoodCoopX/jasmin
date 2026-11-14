"""The HR-system sync of the employee list: whom it adds, renames and
deactivates, whom it leaves alone, and why it refuses to run. The HR system
answers from canned responses, and its host resolves to a public address unless
a test says otherwise."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
import requests
from django.conf import settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.commissioning.tests.factories import JasminUserFactory
from apps.staff.models import Employee
from apps.staff.services.hr_system import (
    SHORT_NAME_MAX_LENGTH,
    HrSystemEmployee,
    weekly_plan_short_names,
)
from apps.staff.viewsets import AbsenceViewSet, EmployeeViewSet

pytestmark = pytest.mark.django_db

_GET = "apps.staff.services.hr_system.requests.get"
_INTERNAL = "apps.staff.services.hr_system.resolves_to_internal_address"
SYNC_URL = "employees-sync-from-hr-system"
EMPLOYEES_URL = "https://hr.example.com/api/employees"


def _answer(payload=None, status_code=200):
    response = MagicMock(status_code=status_code)
    response.json.return_value = payload
    return response


def _entry(hr_system_id, first_name, last_name, active=True):
    return {
        "id": hr_system_id,
        "firstName": first_name,
        "lastName": last_name,
        "name": f"{first_name} {last_name}",
        "active": active,
    }


def _sync(client, employees, **body):
    with patch(_GET, return_value=_answer(employees)) as get:
        response = client.post(reverse(SYNC_URL), body, format="json")
    return response, get


@pytest.fixture(autouse=True)
def _public_hosts():
    with patch(_INTERNAL, return_value=False) as internal:
        yield internal


@pytest.fixture()
def hr_system_tenant(tenant):
    tenant.uses_hr_system = True
    tenant.hr_system_employees_url = EMPLOYEES_URL
    tenant.hr_system_api_token = "hr-secret"
    tenant.save()
    return tenant


def _synced(hr_system_id, short_name, **fields):
    return Employee.objects.create(
        comes_from_hr_system=True,
        hr_system_id=hr_system_id,
        short_name_for_weekly_plan=short_name,
        **fields,
    )


def _person(hr_system_id, first_name, last_name):
    return HrSystemEmployee(hr_system_id, first_name, last_name)


class TestWeeklyPlanShortNames:
    def test_a_first_name_held_once_stands_alone(self):
        names = weekly_plan_short_names(
            [_person("1", "Anna", "Müller"), _person("2", "Ben", "Kurz")], taken=[]
        )

        assert names == {"1": "Anna", "2": "Ben"}

    def test_a_shared_first_name_takes_as_many_letters_as_it_needs(self):
        names = weekly_plan_short_names(
            [
                _person("1", "Anna", "Müller"),
                _person("2", "Anna", "Maier"),
                _person("3", "Anna", "Schmidt"),
            ],
            taken=[],
        )

        assert names == {"1": "Anna Mü", "2": "Anna Ma", "3": "Anna S"}

    def test_a_last_name_that_begins_another_is_written_out(self):
        names = weekly_plan_short_names(
            [_person("1", "Anna", "Mai"), _person("2", "Anna", "Maier")], taken=[]
        )

        assert names == {"1": "Anna Mai", "2": "Anna Maie"}

    def test_first_names_differing_only_in_case_count_as_the_same(self):
        names = weekly_plan_short_names(
            [_person("1", "Anna", "Müller"), _person("2", "anna", "Schmidt")],
            taken=[],
        )

        assert names == {"1": "Anna M", "2": "anna S"}

    def test_a_name_another_employee_holds_is_told_apart_from(self):
        names = weekly_plan_short_names(
            [_person("1", "Anna", "Müller")], taken=["Anna", "anna m"]
        )

        assert names == {"1": "Anna Mü"}

    def test_the_same_full_name_twice_is_numbered(self):
        names = weekly_plan_short_names(
            [_person("1", "Anna", "Müller"), _person("2", "Anna", "Müller")],
            taken=[],
        )

        assert names == {"1": "Anna Müller", "2": "Anna Müller 2"}

    def test_a_person_without_a_first_name_goes_by_the_last_name(self):
        names = weekly_plan_short_names([_person("1", "", "Müller")], taken=[])

        assert names == {"1": "Müller"}

    def test_the_length_cap_is_the_column_length(self):
        field = Employee._meta.get_field("short_name_for_weekly_plan")

        assert SHORT_NAME_MAX_LENGTH == field.max_length

    def test_a_long_name_fits_the_column_even_when_numbered(self):
        long_last_name = "L" * 60
        names = weekly_plan_short_names(
            [
                _person("1", "Anna", long_last_name),
                _person("2", "Anna", long_last_name),
            ],
            taken=[],
        )

        assert {len(name) for name in names.values()} == {50}
        assert names["1"] != names["2"]
        assert names["2"].endswith(" 2")

    def test_a_name_cut_at_the_column_length_keeps_no_trailing_space(self):
        first_name = "F" * 49
        names = weekly_plan_short_names(
            [_person("1", first_name, "Müller"), _person("2", first_name, "Maier")],
            taken=[],
        )

        # Maier comes first; no letter of either last name fits after the cut.
        assert names == {"2": first_name, "1": f"{'F' * 48} 2"}

    def test_equal_names_are_numbered_in_numeric_id_order(self):
        names = weekly_plan_short_names(
            [_person("10", "Anna", "Müller"), _person("9", "Anna", "Müller")],
            taken=[],
        )

        assert names == {"9": "Anna Müller", "10": "Anna Müller 2"}


class TestSync:
    def test_adds_new_employees_with_their_names(self, api_client, hr_system_tenant):
        response, _ = _sync(
            api_client,
            [_entry("hr-1", "Anna", "Müller"), _entry("hr-2", "Ben", "Kurz")],
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data == {
            "created": 2,
            "updated": 0,
            "deactivated": 0,
        }
        anna = Employee.objects.get(hr_system_id="hr-1")
        assert anna.comes_from_hr_system is True
        assert anna.is_active is True
        assert (anna.first_name, anna.last_name) == ("Anna", "Müller")
        assert anna.short_name_for_weekly_plan == "Anna"

    def test_sends_the_token_as_a_bearer_token(self, api_client, hr_system_tenant):
        _, get = _sync(api_client, [_entry("hr-1", "Anna", "Müller")])

        get.assert_called_once()
        assert get.call_args.args == (EMPLOYEES_URL,)
        assert get.call_args.kwargs["headers"]["Authorization"] == "Bearer hr-secret"
        assert get.call_args.kwargs["timeout"] > 0
        assert get.call_args.kwargs["allow_redirects"] is False

    def test_deactivates_an_employee_gone_from_hr_system(
        self, api_client, hr_system_tenant
    ):
        gone = _synced("hr-1", "Anna")
        _synced("hr-2", "Ben", first_name="Ben", last_name="Kurz")
        _synced("hr-3", "Carla", first_name="Carla", last_name="Weiß")

        response, _ = _sync(
            api_client,
            [_entry("hr-2", "Ben", "Kurz"), _entry("hr-3", "Carla", "Weiß")],
        )

        assert response.data == {
            "created": 0,
            "updated": 0,
            "deactivated": 1,
        }
        gone.refresh_from_db()
        assert gone.is_active is False
        assert gone.short_name_for_weekly_plan == "Anna"

    def test_deactivates_an_employee_locked_in_hr_system(
        self, api_client, hr_system_tenant
    ):
        locked = _synced("hr-1", "Anna", first_name="Anna", last_name="Müller")
        _synced("hr-2", "Ben", first_name="Ben", last_name="Kurz")
        _synced("hr-3", "Carla", first_name="Carla", last_name="Weiß")

        _sync(
            api_client,
            [
                _entry("hr-1", "Anna", "Müller", active=False),
                _entry("hr-2", "Ben", "Kurz"),
                _entry("hr-3", "Carla", "Weiß"),
            ],
        )

        locked.refresh_from_db()
        assert locked.is_active is False

    def test_asks_before_deactivating_more_than_half(
        self, api_client, hr_system_tenant
    ):
        _synced("hr-1", "Anna")
        _synced("hr-2", "Ben")
        _synced("hr-3", "Carla", first_name="Carla", last_name="Weiß")

        response, _ = _sync(api_client, [_entry("hr-3", "Carla", "Weiß")])

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data["code"] == "staff.hr_system_mass_deactivation"
        assert response.data["details"] == {"employees": ["Anna", "Ben"]}
        assert Employee.objects.filter(is_active=True).count() == 3

    def test_deactivates_more_than_half_once_confirmed(
        self, api_client, hr_system_tenant
    ):
        _synced("hr-1", "Anna")
        _synced("hr-2", "Ben")
        _synced("hr-3", "Carla", first_name="Carla", last_name="Weiß")

        response, _ = _sync(
            api_client,
            [_entry("hr-3", "Carla", "Weiß")],
            confirm_deactivations=True,
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data["deactivated"] == 2
        assert list(
            Employee.objects.filter(is_active=True).values_list(
                "short_name_for_weekly_plan", flat=True
            )
        ) == ["Carla"]

    def test_deactivates_half_without_asking(self, api_client, hr_system_tenant):
        _synced("hr-1", "Anna")
        _synced("hr-2", "Ben", first_name="Ben", last_name="Kurz")

        response, _ = _sync(api_client, [_entry("hr-2", "Ben", "Kurz")])

        assert response.status_code == status.HTTP_200_OK
        assert response.data["deactivated"] == 1

    def test_reactivates_a_returning_employee(self, api_client, hr_system_tenant):
        returning = _synced(
            "hr-1", "Anna", first_name="Anna", last_name="Müller", is_active=False
        )

        response, _ = _sync(api_client, [_entry("hr-1", "Anna", "Müller")])

        assert response.data == {
            "created": 0,
            "updated": 1,
            "deactivated": 0,
        }
        returning.refresh_from_db()
        assert returning.is_active is True

    def test_takes_over_a_renamed_employee(self, api_client, hr_system_tenant):
        renamed = _synced("hr-1", "Anna", first_name="Anna", last_name="Müller")

        _sync(api_client, [_entry("hr-1", "Annika", "Berger")])

        renamed.refresh_from_db()
        assert (renamed.first_name, renamed.last_name) == ("Annika", "Berger")
        assert renamed.short_name_for_weekly_plan == "Annika"

    def test_leaves_the_weekly_hours_to_the_office(self, api_client, hr_system_tenant):
        anna = _synced("hr-1", "Anna", first_name="Anna", hours_per_week=20)

        _sync(
            api_client,
            [_entry("hr-1", "Annika", "Berger"), _entry("hr-2", "Ben", "Kraus")],
        )

        anna.refresh_from_db()
        assert anna.hours_per_week == 20
        assert Employee.objects.get(hr_system_id="hr-2").hours_per_week is None

    def test_counts_nothing_when_nothing_changed(self, api_client, hr_system_tenant):
        _synced("hr-1", "Anna", first_name="Anna", last_name="Müller")

        response, _ = _sync(api_client, [_entry("hr-1", "Anna", "Müller")])

        assert response.data == {
            "created": 0,
            "updated": 0,
            "deactivated": 0,
        }

    def test_tells_apart_a_newcomer_of_the_same_first_name(
        self, api_client, hr_system_tenant
    ):
        anna = _synced("hr-1", "Anna", first_name="Anna", last_name="Müller")

        _sync(
            api_client,
            [_entry("hr-1", "Anna", "Müller"), _entry("hr-2", "Anna", "Schmidt")],
        )

        anna.refresh_from_db()
        assert anna.short_name_for_weekly_plan == "Anna M"
        newcomer = Employee.objects.get(hr_system_id="hr-2")
        assert newcomer.short_name_for_weekly_plan == "Anna S"

    def test_keeps_clear_of_the_names_other_employees_hold(
        self, api_client, hr_system_tenant
    ):
        Employee.objects.create(short_name_for_weekly_plan="Anna")
        _synced("hr-9", "Anna M", is_active=False)

        _sync(api_client, [_entry("hr-1", "Anna", "Müller")])

        newcomer = Employee.objects.get(hr_system_id="hr-1")
        assert newcomer.short_name_for_weekly_plan == "Anna Mü"

    def test_leaves_employees_outside_the_sync_alone(
        self, api_client, hr_system_tenant
    ):
        manual = Employee.objects.create(
            short_name_for_weekly_plan="Carla",
            first_name="Carla",
            last_name="Weiß",
        )

        response, _ = _sync(api_client, [_entry("hr-2", "Ben", "Kurz")])

        assert response.data == {
            "created": 1,
            "updated": 0,
            "deactivated": 0,
        }
        manual.refresh_from_db()
        assert manual.is_active is True

    def test_adds_its_own_employee_next_to_a_namesake_entered_in_jasmin(
        self, api_client, hr_system_tenant
    ):
        entered = Employee.objects.create(
            short_name_for_weekly_plan="Anna", first_name="Anna", last_name="Müller"
        )

        response, _ = _sync(api_client, [_entry("hr-1", "Anna", "Müller")])

        assert response.data["created"] == 1
        entered.refresh_from_db()
        assert entered.hr_system_id is None
        assert entered.comes_from_hr_system is False
        assert entered.short_name_for_weekly_plan == "Anna"
        newcomer = Employee.objects.get(hr_system_id="hr-1")
        assert newcomer.short_name_for_weekly_plan == "Anna M"

    def test_adds_an_employee_listed_twice_once(self, api_client, hr_system_tenant):
        response, _ = _sync(
            api_client,
            [_entry("hr-1", "Anna", "Müller"), _entry(" hr-1 ", "Anna", "Müller")],
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data["created"] == 1
        assert Employee.objects.filter(hr_system_id="hr-1").count() == 1

    def test_cuts_names_longer_than_their_columns(self, api_client, hr_system_tenant):
        response, _ = _sync(
            api_client,
            [_entry("hr-1", "A" * 250, "B" * 250), _entry("hr-2", "Ben", "Kurz")],
        )

        assert response.data["created"] == 2
        long_named = Employee.objects.get(hr_system_id="hr-1")
        assert (len(long_named.first_name), len(long_named.last_name)) == (200, 200)
        assert long_named.short_name_for_weekly_plan == "A" * 50

    def test_skips_an_entry_without_a_name(self, api_client, hr_system_tenant):
        nameless = {
            "id": "hr-2",
            "firstName": None,
            "lastName": None,
            "name": "",
            "active": True,
        }

        response, _ = _sync(api_client, [nameless])

        assert response.data["created"] == 0

    def test_takes_the_display_name_when_first_and_last_name_are_missing(
        self, api_client, hr_system_tenant
    ):
        _sync(
            api_client,
            [
                {
                    "id": "hr-1",
                    "firstName": None,
                    "lastName": None,
                    "name": "Werkstatt",
                    "active": True,
                }
            ],
        )

        assert (
            Employee.objects.get(hr_system_id="hr-1").short_name_for_weekly_plan
            == "Werkstatt"
        )

    def test_reads_names_from_text_only(self, api_client, hr_system_tenant):
        """Anything else in a name field may carry more of the HR system's
        record, such as an email address or a birth date."""
        _sync(
            api_client,
            [
                {
                    "id": "hr-1",
                    "firstName": {"email": "anna@example.com"},
                    "lastName": ["1990-01-01"],
                    "name": "Anna",
                    "active": True,
                }
            ],
        )

        anna = Employee.objects.get(hr_system_id="hr-1")
        # The display name stands in for the missing first name.
        assert (anna.first_name, anna.short_name_for_weekly_plan) == ("Anna", "Anna")
        assert not anna.last_name


class TestWhatReachesTheHrSystem:
    """The sync only ever reads: it sends GET requests, nothing else."""

    def test_nothing_but_get_requests(self, api_client, hr_system_tenant):
        with patch("apps.staff.services.hr_system.requests") as http:
            http.RequestException = requests.RequestException
            http.get.return_value = _answer([_entry("hr-1", "Anna", "Müller")])
            response = api_client.post(reverse(SYNC_URL))

        assert response.status_code == status.HTTP_200_OK, response.content
        assert {name for name, _args, _kwargs in http.method_calls} == {"get"}

    @pytest.mark.parametrize("viewset", [EmployeeViewSet, AbsenceViewSet])
    def test_the_sync_runs_under_its_own_rate_limit(self, viewset):
        view = viewset()
        view.action = "sync_from_hr_system"
        view.get_throttles()

        assert view.throttle_scope == "hr_system_sync"
        assert "hr_system_sync" in settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]


class TestSyncRefusals:
    def test_refuses_a_plain_http_address(self, api_client, hr_system_tenant):
        """The address may have reached the database without the settings'
        own check; the token must not travel unencrypted."""
        hr_system_tenant.hr_system_employees_url = "http://hr.example.com/api/staff"
        hr_system_tenant.save()

        with patch(_GET) as get:
            response = api_client.post(reverse(SYNC_URL))

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data["code"] == "staff.hr_system_address_not_allowed"
        get.assert_not_called()

    @pytest.mark.parametrize(
        ("uses_hr_system", "url", "token"),
        [
            (False, EMPLOYEES_URL, "hr-secret"),
            (True, "", "hr-secret"),
            (True, EMPLOYEES_URL, ""),
            (True, EMPLOYEES_URL, None),
        ],
    )
    def test_refuses_without_the_setting_an_address_and_a_token(
        self, api_client, tenant, uses_hr_system, url, token
    ):
        tenant.uses_hr_system = uses_hr_system
        tenant.hr_system_employees_url = url
        tenant.hr_system_api_token = token
        tenant.save()

        with patch(_GET) as get:
            response = api_client.post(reverse(SYNC_URL))

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data["code"] == "staff.hr_system_not_set_up"
        get.assert_not_called()

    def test_refuses_an_address_that_leads_into_an_internal_network(
        self, api_client, hr_system_tenant, _public_hosts
    ):
        _public_hosts.return_value = True

        with patch(_GET) as get:
            response = api_client.post(reverse(SYNC_URL))

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data["code"] == "staff.hr_system_address_not_allowed"
        _public_hosts.assert_called_once_with("hr.example.com")
        get.assert_not_called()

    @pytest.mark.parametrize(
        ("status_code", "code", "http_status"),
        [
            (401, "staff.hr_system_token_rejected", status.HTTP_409_CONFLICT),
            (403, "staff.hr_system_token_rejected", status.HTTP_409_CONFLICT),
            # Not followed: a redirect could lead anywhere.
            (302, "staff.hr_system_unavailable", status.HTTP_502_BAD_GATEWAY),
            (429, "staff.hr_system_unavailable", status.HTTP_502_BAD_GATEWAY),
            (500, "staff.hr_system_unavailable", status.HTTP_502_BAD_GATEWAY),
        ],
    )
    def test_reports_what_the_hr_system_answered(
        self, api_client, hr_system_tenant, status_code, code, http_status
    ):
        with patch(_GET, return_value=_answer(status_code=status_code)):
            response = api_client.post(reverse(SYNC_URL))

        assert response.status_code == http_status
        assert response.data["code"] == code

    def test_takes_the_sync_lock(self, api_client, hr_system_tenant):
        with patch("apps.staff.services.hr_system.acquire_advisory_xact_lock") as lock:
            _sync(api_client, [_entry("hr-1", "Anna", "Müller")])

        lock.assert_called_once_with("hr_system_sync")

    def test_reports_the_hr_system_out_of_reach(self, api_client, hr_system_tenant):
        with patch(_GET, side_effect=requests.ConnectionError("down")):
            response = api_client.post(reverse(SYNC_URL))

        assert response.status_code == status.HTTP_502_BAD_GATEWAY
        assert response.data["code"] == "staff.hr_system_unavailable"

    @pytest.mark.parametrize(
        "answer",
        [
            {"error": "maintenance"},
            # The token's own account is always listed.
            [],
            ["not an employee"],
            [{"id": "", "firstName": "Anna", "active": True}],
            # Longer than an employee's stored id can be.
            [{"id": "x" * 65, "firstName": "Anna", "active": True}],
            [{"firstName": "Anna", "active": True}],
            [{"id": 7, "firstName": "Anna", "active": True}],
            [{"id": "hr-1", "firstName": "Anna", "active": "true"}],
            [{"id": "hr-1", "firstName": "Anna"}],
        ],
    )
    def test_refuses_an_answer_that_is_not_a_list_of_employees(
        self, api_client, hr_system_tenant, answer
    ):
        employee = _synced("hr-1", "Anna")

        response, _ = _sync(api_client, answer)

        assert response.status_code == status.HTTP_502_BAD_GATEWAY
        assert response.data["code"] == "staff.hr_system_unavailable"
        employee.refresh_from_db()
        assert employee.is_active is True

    def test_reports_an_answer_that_is_no_json(self, api_client, hr_system_tenant):
        answer = _answer()
        answer.json.side_effect = ValueError("not JSON")
        with patch(_GET, return_value=answer):
            response = api_client.post(reverse(SYNC_URL))

        assert response.status_code == status.HTTP_502_BAD_GATEWAY

    @pytest.mark.parametrize("roles", [["gardener"], ["staff"], ["member"]])
    def test_only_the_office_may_sync(self, hr_system_tenant, roles):
        client = APIClient()
        client.force_authenticate(user=JasminUserFactory(roles=roles))

        with patch(_GET) as get:
            response = client.post(reverse(SYNC_URL))

        assert response.status_code == status.HTTP_403_FORBIDDEN
        get.assert_not_called()


class TestTheMarkIsTheSyncs:
    """Only the sync sets ``comes_from_hr_system`` and ``hr_system_id``; the
    API reads them out but takes neither."""

    def test_a_new_employee_cannot_claim_to_come_from_hr_system(self, api_client):
        response = api_client.post(
            reverse("employees-list"),
            {
                "short_name_for_weekly_plan": "Pia",
                "comes_from_hr_system": True,
                "hr_system_id": "hr-1",
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["comes_from_hr_system"] is False
        pia = Employee.objects.get(short_name_for_weekly_plan="Pia")
        assert (pia.comes_from_hr_system, pia.hr_system_id) == (False, None)

    def test_a_synced_employee_cannot_be_taken_out_of_the_sync(self, api_client):
        anna = _synced("hr-1", "Anna")

        response = api_client.patch(
            reverse("employees-detail", args=[anna.pk]),
            {"comes_from_hr_system": False, "hr_system_id": None},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        anna.refresh_from_db()
        assert (anna.comes_from_hr_system, anna.hr_system_id) == (True, "hr-1")
