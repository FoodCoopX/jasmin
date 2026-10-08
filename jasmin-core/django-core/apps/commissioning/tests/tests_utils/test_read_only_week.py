"""``is_week_read_only`` — the day a week turns read-only.

Mirrors the documentation pages' ``isWeekInPast``: a week is read-only once
two whole weeks have passed since its Monday.
"""

from __future__ import annotations

import datetime

import pytest
import time_machine

from apps.commissioning.utils.read_only_week import is_week_read_only


@pytest.fixture(autouse=True)
def _frozen_clock():
    # Every case passes its own ``today``; the frozen clock keeps a dropped
    # argument from reading the wall clock.
    with time_machine.travel(datetime.datetime(2026, 1, 5, 12, 0), tick=False):
        yield


@pytest.mark.parametrize(
    ("today", "expected"),
    [
        # Week 39 of 2026 starts on Monday 2026-09-21.
        (datetime.date(2026, 9, 21), False),  # its own week
        (datetime.date(2026, 10, 4), False),  # last day of the grace week
        (datetime.date(2026, 10, 5), True),  # Monday two weeks on
        (datetime.date(2026, 12, 1), True),
    ],
)
def test_week_turns_read_only_two_weeks_after_its_monday(today, expected):
    assert is_week_read_only(2026, 39, today=today) is expected


def test_year_boundary():
    # Week 52 of 2026 starts on Monday 2026-12-21; two weeks on is 2027-01-04.
    assert is_week_read_only(2026, 52, today=datetime.date(2027, 1, 3)) is False
    assert is_week_read_only(2026, 52, today=datetime.date(2027, 1, 4)) is True


def test_future_week_is_writable():
    assert is_week_read_only(2026, 45, today=datetime.date(2026, 10, 5)) is False
