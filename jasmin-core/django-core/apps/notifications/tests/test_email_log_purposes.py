"""The email log's purposes: what the purpose filter can offer.

Most sends log their template slug as purpose, but some log one of their own
(``invoice:reseller``, ``invoice:accounting``, ``delivery_note:reseller``,
``test:<slug>``, ``test:smtp``). The purposes endpoint lists every purpose the
log holds, so the filter offers exactly what it can find.
"""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.commissioning.tests.factories import JasminUserFactory
from apps.notifications.models import EmailLog


def _log(purpose: str, *, template: str, recipient: str = "a@example.org") -> None:
    EmailLog.objects.create(
        recipient=recipient,
        subject="",
        template=template,
        purpose=purpose,
        status="sent",
    )


def _client(roles: list[str]) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=JasminUserFactory(roles=roles))
    return client


@pytest.fixture()
def office_client(tenant):
    return _client(["office"])


@pytest.mark.django_db
class TestPurposes:
    def test_lists_each_logged_purpose_once_sorted_without_blanks(self, office_client):
        EmailLog.objects.all().delete()
        _log("invoice:reseller", template="commissioning.invoice")
        _log("invoice:reseller", template="commissioning.invoice")
        _log("invoice:accounting", template="commissioning.invoice")
        _log("delivery_note:reseller", template="commissioning.delivery_note")
        _log("test:commissioning.offer", template="commissioning.offer")
        _log("test:smtp", template="tenants.smtp_test")
        _log("commissioning.offer", template="commissioning.offer")
        _log("", template="accounts.invitation")

        resp = office_client.get(reverse("email-log-purposes"))

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert resp.data == {
            "purposes": [
                "commissioning.offer",
                "delivery_note:reseller",
                "invoice:accounting",
                "invoice:reseller",
                "test:commissioning.offer",
                "test:smtp",
            ]
        }

    def test_an_empty_log_has_no_purposes(self, office_client):
        EmailLog.objects.all().delete()

        resp = office_client.get(reverse("email-log-purposes"))

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert resp.data == {"purposes": []}

    def test_members_may_not_read_the_purposes(self, tenant):
        resp = _client(["member"]).get(reverse("email-log-purposes"))

        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_each_listed_purpose_finds_its_rows(self, office_client):
        EmailLog.objects.all().delete()
        _log("invoice:reseller", template="commissioning.invoice", recipient="r@x.org")
        _log("commissioning.invoice", template="commissioning.invoice")

        resp = office_client.get(
            reverse("email-log-list"), {"purpose": "invoice:reseller"}
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert [row["recipient"] for row in resp.data] == ["r@x.org"]
