"""The tenant's HR-system settings: the switch every staff page reads; the
addresses, which must be https addresses of one public server; and the API
token, which is stored encrypted, never sent back, changed only with a fresh
step-up claim — as are the addresses — and dropped when the addresses leave
its server."""

from __future__ import annotations

from importlib import import_module
from unittest.mock import patch

import pytest
from django.conf import settings
from django.db import connection
from rest_framework import serializers
from rest_framework.test import APIClient

from apps.commissioning.tests.conftest import make_step_up_token
from apps.commissioning.tests.factories import JasminUserFactory
from apps.shared.tenants.models import Tenant

STORED_TOKEN = "hr-stored"
EMPLOYEES_URL = "https://hr.example.com/api/employees"
_INTERNAL = "apps.shared.tenants.serializers.resolves_to_internal_address"


def _subclasses(cls):
    for subclass in cls.__subclasses__():
        yield subclass
        yield from _subclasses(subclass)


def test_no_tenant_serializer_reads_the_token_out():
    """A ``fields = "__all__"`` serializer on Tenant would send the decrypted
    token; each one has to take it write-only."""
    # Every serializer an endpoint uses is imported along with the URLs.
    import_module(settings.ROOT_URLCONF)
    import_module(settings.PUBLIC_SCHEMA_URLCONF)
    tenant_serializers = [
        serializer
        for serializer in set(_subclasses(serializers.ModelSerializer))
        if getattr(getattr(serializer, "Meta", None), "model", None) is Tenant
    ]

    assert tenant_serializers
    for serializer in tenant_serializers:
        field = serializer().fields.get("hr_system_api_token")
        assert field is None or field.write_only, serializer.__name__


def _detail_url(tenant) -> str:
    return f"/api/tenants/tenants/{tenant.id}/"


def _stored(tenant, field: str):
    return getattr(Tenant.objects.get(pk=tenant.pk), field)


def _raw_token(tenant) -> str | None:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT hr_system_api_token FROM public.tenants_tenant WHERE id = %s",
            [tenant.pk],
        )
        return cursor.fetchone()[0]


@pytest.fixture(autouse=True)
def _public_hosts():
    with patch(_INTERNAL, return_value=False) as internal:
        yield internal


@pytest.fixture()
def admin(tenant):
    return JasminUserFactory(roles=["admin"])


@pytest.fixture()
def admin_client(admin, tenant_host):
    client = APIClient(HTTP_HOST=tenant_host)
    client.force_authenticate(user=admin)
    return client


@pytest.fixture()
def admin_step_up_client(admin, tenant_host):
    client = APIClient(HTTP_HOST=tenant_host)
    client.force_authenticate(user=admin, token=make_step_up_token(admin))
    return client


@pytest.fixture()
def stored_settings(tenant):
    tenant.uses_hr_system = True
    tenant.hr_system_employees_url = EMPLOYEES_URL
    tenant.hr_system_api_token = STORED_TOKEN
    tenant.save()


@pytest.mark.django_db
class TestTheSwitchAndTheToken:
    def test_the_switch_reaches_get_setting(self, admin_client, tenant):
        tenant.uses_hr_system = True
        tenant.save()

        body = admin_client.get(_detail_url(tenant)).json()

        assert body["uses_hr_system"] is True
        assert body["settings"]["uses_hr_system"] is True

    @pytest.mark.usefixtures("stored_settings")
    @pytest.mark.parametrize("roles", [["admin"], ["office"], ["member"]])
    def test_the_token_is_never_sent_back(self, tenant, tenant_host, roles):
        client = APIClient(HTTP_HOST=tenant_host)
        client.force_authenticate(user=JasminUserFactory(roles=roles))

        response = client.get(_detail_url(tenant))

        assert response.status_code == 200
        assert "hr_system_api_token" not in response.json()
        assert STORED_TOKEN not in response.content.decode()

    @pytest.mark.usefixtures("stored_settings")
    def test_staff_learn_only_whether_one_is_stored(self, admin_client, tenant):
        body = admin_client.get(_detail_url(tenant)).json()

        assert body["has_hr_system_api_token"] is True

    def test_a_tenant_without_a_token_says_so(self, admin_client, tenant):
        body = admin_client.get(_detail_url(tenant)).json()

        assert body["has_hr_system_api_token"] is False

    def test_storing_a_token_needs_step_up(self, admin_client, tenant):
        response = admin_client.patch(
            _detail_url(tenant), {"hr_system_api_token": "hr-new"}, format="json"
        )

        assert response.status_code == 403
        assert response.data["code"] == "auth.step_up_required"
        assert not _stored(tenant, "hr_system_api_token")

    def test_a_stored_token_is_encrypted(self, admin_step_up_client, tenant):
        response = admin_step_up_client.patch(
            _detail_url(tenant), {"hr_system_api_token": " hr-new "}, format="json"
        )

        assert response.status_code == 200, response.content
        assert response.json()["has_hr_system_api_token"] is True
        assert "hr_system_api_token" not in response.json()
        assert _stored(tenant, "hr_system_api_token") == "hr-new"
        assert "hr-new" not in (_raw_token(tenant) or "")

    @pytest.mark.parametrize(
        "token", ["hr new", "hr-new​", "hr-“new”", "hr-new\nX-Other: 1"]
    )
    def test_a_token_a_header_cannot_carry_is_refused(
        self, admin_step_up_client, tenant, token
    ):
        response = admin_step_up_client.patch(
            _detail_url(tenant), {"hr_system_api_token": token}, format="json"
        )

        assert response.status_code == 400
        assert response.data["code"] == "tenant.hr_system_token_invalid"
        assert not _stored(tenant, "hr_system_api_token")

    @pytest.mark.usefixtures("stored_settings")
    def test_a_blank_token_keeps_the_stored_one(self, admin_step_up_client, tenant):
        response = admin_step_up_client.patch(
            _detail_url(tenant), {"hr_system_api_token": ""}, format="json"
        )

        assert response.status_code == 200, response.content
        assert _stored(tenant, "hr_system_api_token") == STORED_TOKEN

    @pytest.mark.usefixtures("stored_settings")
    def test_null_removes_the_token(self, admin_step_up_client, tenant):
        response = admin_step_up_client.patch(
            _detail_url(tenant), {"hr_system_api_token": None}, format="json"
        )

        assert response.status_code == 200, response.content
        assert response.json()["has_hr_system_api_token"] is False
        assert not _stored(tenant, "hr_system_api_token")

    @pytest.mark.usefixtures("stored_settings")
    def test_sending_the_stored_token_again_needs_step_up_too(
        self, admin_client, tenant
    ):
        """Otherwise the answer would tell, without step-up, whether a guess
        is the stored token."""
        response = admin_client.patch(
            _detail_url(tenant), {"hr_system_api_token": STORED_TOKEN}, format="json"
        )

        assert response.status_code == 403
        assert response.data["code"] == "auth.step_up_required"

    @pytest.mark.usefixtures("stored_settings")
    def test_removing_the_token_needs_step_up(self, admin_client, tenant):
        response = admin_client.patch(
            _detail_url(tenant), {"hr_system_api_token": None}, format="json"
        )

        assert response.status_code == 403
        assert _stored(tenant, "hr_system_api_token") == STORED_TOKEN

    @pytest.mark.usefixtures("stored_settings")
    def test_a_blank_token_needs_no_step_up(self, admin_client, tenant):
        response = admin_client.patch(
            _detail_url(tenant), {"hr_system_api_token": ""}, format="json"
        )

        assert response.status_code == 200, response.content
        assert _stored(tenant, "hr_system_api_token") == STORED_TOKEN

    @pytest.mark.usefixtures("stored_settings")
    def test_an_edit_without_the_token_keeps_it_unprompted(self, admin_client, tenant):
        response = admin_client.patch(
            _detail_url(tenant), {"uses_hr_system": False}, format="json"
        )

        assert response.status_code == 200, response.content
        assert _stored(tenant, "hr_system_api_token") == STORED_TOKEN


@pytest.mark.django_db
class TestTheAddresses:
    @pytest.mark.parametrize(
        "field", ["hr_system_employees_url", "hr_system_absences_url"]
    )
    def test_an_https_address_of_a_public_server_is_stored(
        self, admin_step_up_client, tenant, field, _public_hosts
    ):
        response = admin_step_up_client.patch(
            _detail_url(tenant), {field: EMPLOYEES_URL}, format="json"
        )

        assert response.status_code == 200, response.content
        assert response.json()[field] == EMPLOYEES_URL
        assert _stored(tenant, field) == EMPLOYEES_URL
        _public_hosts.assert_called_with("hr.example.com")

    def test_a_plain_http_address_is_refused(self, admin_step_up_client, tenant):
        response = admin_step_up_client.patch(
            _detail_url(tenant),
            {"hr_system_employees_url": "http://hr.example.com/api/employees"},
            format="json",
        )

        assert response.status_code == 400
        assert response.data["code"] == "tenant.hr_system_address_invalid"
        assert response.data["field"] == "hr_system_employees_url"

    def test_an_address_leading_into_an_internal_network_is_refused(
        self, admin_step_up_client, tenant, _public_hosts
    ):
        _public_hosts.return_value = True

        response = admin_step_up_client.patch(
            _detail_url(tenant),
            {"hr_system_employees_url": "https://169.254.169.254/latest/"},
            format="json",
        )

        assert response.status_code == 400
        assert response.data["code"] == "tenant.hr_system_address_invalid"
        assert not _stored(tenant, "hr_system_employees_url")

    def test_changing_an_address_needs_step_up(self, admin_client, tenant):
        response = admin_client.patch(
            _detail_url(tenant),
            {"hr_system_employees_url": EMPLOYEES_URL},
            format="json",
        )

        assert response.status_code == 403
        assert response.data["code"] == "auth.step_up_required"

    @pytest.mark.usefixtures("stored_settings")
    def test_resending_the_stored_address_needs_no_step_up(self, admin_client, tenant):
        response = admin_client.patch(
            _detail_url(tenant),
            {"hr_system_employees_url": EMPLOYEES_URL},
            format="json",
        )

        assert response.status_code == 200, response.content

    @pytest.mark.usefixtures("stored_settings")
    def test_an_address_can_be_cleared(self, admin_step_up_client, tenant):
        response = admin_step_up_client.patch(
            _detail_url(tenant), {"hr_system_employees_url": ""}, format="json"
        )

        assert response.status_code == 200, response.content
        assert _stored(tenant, "hr_system_employees_url") == ""

    def test_a_token_stored_before_any_address_goes_with_the_first_one(
        self, admin_step_up_client, tenant
    ):
        tenant.hr_system_api_token = STORED_TOKEN
        tenant.save()

        response = admin_step_up_client.patch(
            _detail_url(tenant),
            {"hr_system_employees_url": EMPLOYEES_URL},
            format="json",
        )

        assert response.status_code == 200, response.content
        assert not _stored(tenant, "hr_system_api_token")

    @pytest.mark.usefixtures("stored_settings")
    def test_the_second_address_on_the_first_ones_server_keeps_the_token(
        self, admin_step_up_client, tenant
    ):
        response = admin_step_up_client.patch(
            _detail_url(tenant), {"hr_system_absences_url": ABSENCES_URL}, format="json"
        )

        assert response.status_code == 200, response.content
        assert _stored(tenant, "hr_system_api_token") == STORED_TOKEN


ABSENCES_URL = "https://hr.example.com/api/absences"
OTHER_SERVER = "https://elsewhere.example.net"


@pytest.mark.django_db
class TestTheTokenStaysWithItsServer:
    """The token goes to the addresses' server with every sync, so whoever
    may change the addresses must not be able to point them, and with them
    the stored token, at a server of their own."""

    @pytest.fixture(autouse=True)
    def _both_addresses(self, stored_settings, tenant):
        tenant.hr_system_absences_url = ABSENCES_URL
        tenant.save()

    @pytest.mark.parametrize(
        "address",
        [
            "https://hr.example.com/api/v3/employees",
            "https://HR.example.com:443/api/employees",
        ],
    )
    def test_another_path_on_the_same_server_keeps_it(
        self, admin_step_up_client, tenant, address
    ):
        response = admin_step_up_client.patch(
            _detail_url(tenant), {"hr_system_employees_url": address}, format="json"
        )

        assert response.status_code == 200, response.content
        assert _stored(tenant, "hr_system_api_token") == STORED_TOKEN

    def test_one_address_cannot_lead_to_another_server(
        self, admin_step_up_client, tenant
    ):
        response = admin_step_up_client.patch(
            _detail_url(tenant),
            {"hr_system_absences_url": f"{OTHER_SERVER}/absences"},
            format="json",
        )

        assert response.status_code == 400
        assert response.data["code"] == "tenant.hr_system_addresses_apart"
        assert response.data["field"] == "hr_system_absences_url"
        assert _stored(tenant, "hr_system_absences_url") == ABSENCES_URL
        assert _stored(tenant, "hr_system_api_token") == STORED_TOKEN

    def test_moving_both_addresses_to_another_server_drops_it(
        self, admin_step_up_client, tenant
    ):
        response = admin_step_up_client.patch(
            _detail_url(tenant),
            {
                "hr_system_employees_url": f"{OTHER_SERVER}/employees",
                "hr_system_absences_url": f"{OTHER_SERVER}/absences",
            },
            format="json",
        )

        assert response.status_code == 200, response.content
        assert response.json()["has_hr_system_api_token"] is False
        assert not _stored(tenant, "hr_system_api_token")

    def test_clearing_an_address_drops_it(self, admin_step_up_client, tenant):
        """Else clearing both and setting them anew would carry it over."""
        response = admin_step_up_client.patch(
            _detail_url(tenant), {"hr_system_absences_url": ""}, format="json"
        )

        assert response.status_code == 200, response.content
        assert not _stored(tenant, "hr_system_api_token")

    def test_a_token_sent_with_the_move_is_kept(self, admin_step_up_client, tenant):
        response = admin_step_up_client.patch(
            _detail_url(tenant),
            {
                "hr_system_employees_url": f"{OTHER_SERVER}/employees",
                "hr_system_absences_url": f"{OTHER_SERVER}/absences",
                "hr_system_api_token": "hr-new",
            },
            format="json",
        )

        assert response.status_code == 200, response.content
        assert _stored(tenant, "hr_system_api_token") == "hr-new"
