"""A django-axes lockout emails the operator, at most once an hour."""

from __future__ import annotations

import pytest
from axes.signals import user_locked_out
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _fresh_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.mark.django_db
def test_a_lockout_alerts_the_operator_once_an_hour(
    rf, mailoutbox, django_capture_on_commit_callbacks
):
    request = rf.post("/api/auth/login/")

    with django_capture_on_commit_callbacks(execute=True):
        for _ in range(2):
            user_locked_out.send(
                sender=None,
                request=request,
                username="eve@example.com",
                ip_address="203.0.113.9",
            )

    assert len(mailoutbox) == 1
    assert "eve@example.com" in mailoutbox[0].body
    assert "203.0.113.9" in mailoutbox[0].body
