"""The membership emails and the office's notices write their dates the way the
tenant's app does — in its date format, not a fixed German one."""

from __future__ import annotations

import datetime
from unittest import mock

import pytest

from apps.commissioning.services.member_cancellation import _send_cancellation_email
from apps.commissioning.services.trial_conversion import _send_trial_converted_email
from apps.commissioning.tasks import _notify_office_of_renewal_failures
from apps.commissioning.tests.factories import MemberFactory
from apps.commissioning.views.my_data_views import _notify_office_of_self_cancel
from core.tenant_db import connection

DAY = datetime.date(2025, 12, 31)


@pytest.fixture
def iso_dates(tenant, monkeypatch):
    """The tenant writes dates as ``YYYY-MM-DD`` and has an office address."""
    monkeypatch.setattr(connection.tenant, "date_format", "YYYY-MM-DD")
    monkeypatch.setattr(connection.tenant, "email", "office@example.org")
    return tenant


def _member_email_context(send, *args, **kwargs) -> dict:
    with mock.patch(
        "apps.commissioning.services.member_email.schedule_member_email"
    ) as schedule:
        send(*args, **kwargs)
    return schedule.call_args.kwargs["context"]


def _office_email_context(send, *args) -> dict:
    with mock.patch("apps.shared.deferred_email.send_email_best_effort") as deliver:
        send(*args)
    return deliver.call_args.kwargs["context"]


@pytest.mark.django_db
class TestMemberEmailDates:
    def test_the_exit_date(self, iso_dates):
        member = MemberFactory.build(cancelled_effective_at=DAY)

        context = _member_email_context(
            _send_cancellation_email, member, shares_transferred=False
        )

        assert context["cancelled_effective_at"] == "2025-12-31"

    def test_the_exit_date_the_office_is_told(self, iso_dates):
        member = MemberFactory.build(cancelled_effective_at=DAY)

        context = _office_email_context(_notify_office_of_self_cancel, member)

        assert context["cancelled_effective_at"] == "2025-12-31"

    def test_the_entry_date(self, iso_dates):
        member = MemberFactory.build(entry_date=DAY)

        context = _member_email_context(_send_trial_converted_email, member)

        assert context["entry_date"] == "2025-12-31"

    def test_the_renewal_run_date(self, iso_dates):
        failed = [{"id": "s1", "label": "1", "reason": "no_variation"}]

        context = _office_email_context(
            _notify_office_of_renewal_failures, iso_dates, failed, DAY
        )

        assert context["run_date"] == "2025-12-31"
