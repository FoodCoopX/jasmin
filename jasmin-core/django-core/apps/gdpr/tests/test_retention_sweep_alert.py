"""Blocked ex-member erasures email the operator, per tenant at most weekly."""

from __future__ import annotations

from unittest import mock

import pytest
from django.core.cache import cache

from apps.gdpr.tasks import anonymise_long_cancelled_members

RUN_FOR_SCHEMA = "apps.gdpr.tasks._run_for_current_schema"


@pytest.fixture(autouse=True)
def _fresh_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.mark.django_db
class TestRetentionSweepAlert:
    def test_blocked_erasures_alert_once_a_week(
        self, tenant, mailoutbox, django_capture_on_commit_callbacks
    ):
        with mock.patch(RUN_FOR_SCHEMA, return_value=(0, 2)):
            with django_capture_on_commit_callbacks(execute=True):
                anonymise_long_cancelled_members.call_local()
            first_run = len(mailoutbox)
            with django_capture_on_commit_callbacks(execute=True):
                anonymise_long_cancelled_members.call_local()

        assert first_run >= 1
        assert len(mailoutbox) == first_run
        assert all("2 ex-member erasure(s) blocked" in m.subject for m in mailoutbox)

    def test_nothing_blocked_sends_nothing(
        self, tenant, mailoutbox, django_capture_on_commit_callbacks
    ):
        with (
            mock.patch(RUN_FOR_SCHEMA, return_value=(3, 0)),
            django_capture_on_commit_callbacks(execute=True),
        ):
            anonymise_long_cancelled_members.call_local()

        assert mailoutbox == []
