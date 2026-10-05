"""The invitation email says when its link expires, written the way the
tenant's app writes dates and times, in the server's time zone."""

from __future__ import annotations

import datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from apps.commissioning.tests.factories import JasminUserFactory
from apps.shared.invitations import _send_invitation_email
from apps.shared.tenants.onboarding_emails import EmailCategory
from core.tenant_db import connection

pytestmark = pytest.mark.django_db


def test_the_expiry_in_the_tenants_formats(tenant, settings, monkeypatch):
    settings.TIME_ZONE = "Europe/Berlin"
    monkeypatch.setattr(connection.tenant, "date_format", "YYYY-MM-DD")
    invitation = SimpleNamespace(
        token="abc",
        expires_at=datetime.datetime(2025, 12, 31, 22, 59, tzinfo=datetime.UTC),
    )

    with patch("apps.shared.deferred_email.schedule_deferred_email") as schedule:
        _send_invitation_email(
            user=JasminUserFactory(),
            invitation=invitation,
            email_category=EmailCategory.GENERAL,
        )

    assert schedule.call_args.kwargs["context"]["expires_at"] == "2025-12-31, 23:59"
