"""``JasminAuditlogMiddleware``: who made a change and from where, as the audit
log records it for a request authenticated with a real JWT.

The requests carry an ``Authorization: Bearer`` header rather than going
through ``force_authenticate``: both authenticate inside DRF, after every
middleware has run, and the header is the path production takes.
"""

from __future__ import annotations

import pytest
from auditlog.models import LogEntry
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.commissioning.models import CoopShare
from apps.commissioning.tests.factories import CoopShareFactory

pytestmark = pytest.mark.django_db


@pytest.fixture()
def bearer_client(tenant, user) -> APIClient:
    token = AccessToken.for_user(user)
    token["tenant_id"] = tenant.schema_name
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


def _patch_note(client: APIClient, share: CoopShare, **headers):
    return client.patch(
        reverse("coop_shares-detail", kwargs={"pk": share.pk}),
        {"note": "Paid in cash."},
        format="json",
        **headers,
    )


def _update_entry(share: CoopShare) -> LogEntry:
    return (
        LogEntry.objects.get_for_object(share)
        .filter(action=LogEntry.Action.UPDATE)
        .latest("timestamp")
    )


def test_an_api_change_records_the_user_of_the_token(bearer_client, user):
    share = CoopShareFactory(admin_confirmed=False)

    resp = _patch_note(bearer_client, share)

    assert resp.status_code == 200, resp.data
    entry = _update_entry(share)
    assert entry.actor_id == user.pk
    assert entry.actor_email == user.email


def test_the_gateway_entry_of_x_forwarded_for_is_recorded(bearer_client, settings):
    # The gateway appends the real client; the leftmost entry is the client's own.
    settings.TRUSTED_PROXY_COUNT = 1
    share = CoopShareFactory(admin_confirmed=False)

    _patch_note(bearer_client, share, HTTP_X_FORWARDED_FOR="198.51.100.7, 203.0.113.9")

    assert _update_entry(share).remote_addr == "203.0.113.9"


def test_an_address_that_is_not_an_ip_is_left_out(bearer_client, settings):
    settings.TRUSTED_PROXY_COUNT = 1
    share = CoopShareFactory(admin_confirmed=False)

    resp = _patch_note(bearer_client, share, HTTP_X_FORWARDED_FOR="not-an-ip")

    assert resp.status_code == 200, resp.data
    assert _update_entry(share).remote_addr is None
