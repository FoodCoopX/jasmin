"""The share days grid's bulk update: clearing a day, and the week it refuses.

The grid's optional selects offer a blank option whose value is ``""``; the
current page sends ``null`` for it, and a browser still running an older bundle
sends ``""``. Both clear the day, so a holiday move can be undone.

A week is refused (without ``force``) from its Monday on, counted in the farm's
local time as the page counts it in the browser's.
"""

from __future__ import annotations

import datetime

import pytest
import time_machine
from django.urls import reverse
from rest_framework import status

from apps.commissioning.tests.factories import ShareFactory

URL_SHARE_BULK_UPDATE = reverse("share-bulk-update")


@pytest.fixture(autouse=True)
def _frozen_today():
    # ``bulk_update`` refuses a week whose Monday is today or earlier; frozen in
    # week 17, week 30 of 2026 stays in the future.
    with time_machine.travel(datetime.datetime(2026, 4, 22, 12, 0), tick=False):
        yield


def _put(api_client, body):
    return api_client.put(
        URL_SHARE_BULK_UPDATE,
        body,
        format="json",
        QUERY_STRING="year=2026&delivery_week=30",
    )


@pytest.mark.django_db
class TestClearingAShareDay:
    @pytest.mark.parametrize("cleared", [None, ""])
    def test_a_cleared_moved_delivery_day_undoes_the_move(
        self, api_client, tenant, cleared
    ):
        share = ShareFactory(year=2026, delivery_week=30)
        assert (
            _put(api_client, {"changed_day_number": 4}).status_code
            == status.HTTP_200_OK
        )

        resp = _put(api_client, {"changed_day_number": cleared})

        assert resp.status_code == status.HTTP_200_OK, resp.data
        share.refresh_from_db()
        assert share.changed_day_number is None

    def test_a_blank_activity_day_falls_back_to_the_default(self, api_client, tenant):
        share = ShareFactory(year=2026, delivery_week=30)
        assert _put(api_client, {"washing_day": 4}).status_code == status.HTTP_200_OK

        resp = _put(api_client, {"washing_day": ""})

        assert resp.status_code == status.HTTP_200_OK, resp.data
        share.refresh_from_db()
        assert share.washing_day == share.delivery_day.default_washing_day
        assert share.washing_day != 4


@pytest.mark.django_db
class TestWeekBegunInLocalTime:
    def test_the_monday_counts_from_local_midnight(self, api_client, tenant):
        ShareFactory(year=2026, delivery_week=42)
        # 00:30 on Monday 12 October in Berlin, still Sunday in UTC.
        with time_machine.travel(
            datetime.datetime(2026, 10, 11, 22, 30, tzinfo=datetime.UTC), tick=False
        ):
            resp = api_client.put(
                URL_SHARE_BULK_UPDATE,
                {"washing_day": 4},
                format="json",
                QUERY_STRING="year=2026&delivery_week=42",
            )

        assert resp.status_code == status.HTTP_409_CONFLICT, resp.data
        assert resp.data["code"] == "commissioning.past_week"
