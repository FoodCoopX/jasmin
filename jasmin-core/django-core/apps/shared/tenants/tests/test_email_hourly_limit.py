"""``TenantEmailConfig.max_emails_per_hour``: the cap the tenant's mail
provider allows, which ``EmailService`` keeps to.

A send that would go past it, counted over the emails sent in the last hour,
is not sent: its log rows say ``rate_limited`` and carry the limit, and no
SMTP connection opens. Going past a provider's cap can get the account
blocked.
"""

from __future__ import annotations

import datetime
from unittest.mock import patch

import pytest
from django.core import mail
from django.core.mail import get_connection
from django.utils import timezone

from apps.notifications.models import EmailLog
from apps.shared.tenants.email_service import EmailService
from apps.shared.tenants.models import TenantEmailConfig

RESET_CONTEXT = {
    "tenant_name": "Test Tenant",
    "user": {"first_name": "Maria"},
    "reset_url": "https://app.example.org/reset/abc",
    "expires_minutes": "60",
}


@pytest.fixture
def limit_of_three(tenant) -> TenantEmailConfig:
    return TenantEmailConfig.objects.create(
        tenant=tenant,
        smtp_host="localhost",
        smtp_port=25,
        from_email="noreply@example.org",
        from_name="Test Tenant",
        is_active=True,
        is_verified=True,
        max_emails_per_hour=3,
    )


@pytest.fixture(autouse=True)
def connection():
    locmem = get_connection(backend="django.core.mail.backends.locmem.EmailBackend")
    with patch.object(
        EmailService, "_get_connection", return_value=locmem
    ) as get_connection_mock:
        mail.outbox.clear()
        yield get_connection_mock


def _sent_before(count: int, *, minutes_ago: int) -> None:
    rows = EmailLog.objects.bulk_create(
        EmailLog(
            recipient=f"earlier{index}@example.org",
            subject="Earlier",
            status="sent",
        )
        for index in range(count)
    )
    # ``created_at`` is stamped on insert, and ``sent_at`` may not precede it.
    then = timezone.now() - datetime.timedelta(minutes=minutes_ago)
    EmailLog.objects.filter(pk__in=[row.pk for row in rows]).update(
        created_at=then, sent_at=then
    )


def _send(tenant, *recipients: str) -> bool:
    return EmailService(schema_name=tenant.schema_name).send_email(
        slug="accounts.password_reset",
        to_emails=list(recipients),
        context=RESET_CONTEXT,
        language="en",
    )


@pytest.mark.django_db
class TestHourlyEmailLimit:
    def test_a_send_past_the_limit_is_not_sent(
        self, tenant, limit_of_three, connection
    ):
        _sent_before(3, minutes_ago=10)

        assert _send(tenant, "maria@example.org") is False

        assert mail.outbox == []
        connection.assert_not_called()
        row = EmailLog.objects.get(recipient="maria@example.org")
        assert row.status == "rate_limited"
        assert row.error == "max_emails_per_hour=3"
        assert row.sent_at is None

    def test_a_send_within_the_limit_goes_out(self, tenant, limit_of_three):
        _sent_before(2, minutes_ago=10)

        assert _send(tenant, "maria@example.org") is True

        assert len(mail.outbox) == 1
        assert EmailLog.objects.get(recipient="maria@example.org").status == "sent"

    def test_every_recipient_counts(self, tenant, limit_of_three):
        _sent_before(2, minutes_ago=10)

        assert _send(tenant, "maria@example.org", "jonas@example.org") is False

        assert mail.outbox == []
        assert set(
            EmailLog.objects.filter(status="rate_limited").values_list(
                "recipient", flat=True
            )
        ) == {"maria@example.org", "jonas@example.org"}

    def test_mail_sent_more_than_an_hour_ago_does_not_count(
        self, tenant, limit_of_three
    ):
        _sent_before(3, minutes_ago=61)

        assert _send(tenant, "maria@example.org") is True
