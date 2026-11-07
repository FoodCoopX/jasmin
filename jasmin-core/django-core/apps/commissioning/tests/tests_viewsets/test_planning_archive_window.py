"""The planning grid lists a week's plan however early it was entered.

Contents are planned months ahead, and a week's lists must still show them
when the week comes. A second row for a slot the grid already lists is
refused in words, not with a bare integrity error.
"""

from __future__ import annotations

import datetime

import pytest
import time_machine
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from apps.commissioning.models import ShareContent
from apps.commissioning.tests.factories import (
    DeliveryStationDayFactory,
    DeliveryStationFactory,
    ShareArticleFactory,
    SharesDeliveryDayFactory,
    ShareTypeFactory,
    ShareTypeVariationFactory,
)

YEAR, WEEK = 2026, 44
HARVEST = "HARVEST_SHARE"


@pytest.fixture(autouse=True)
def _frozen_clock():
    # Monday of ISO week 44 of 2026, the week planned for.
    with time_machine.travel(datetime.datetime(2026, 10, 26, 12, 0), tick=False):
        yield


@pytest.fixture
def setup(tenant):
    day = SharesDeliveryDayFactory()
    DeliveryStationDayFactory(
        delivery_station=DeliveryStationFactory(is_active=True),
        delivery_day=day,
        tour_number=1,
    )
    return {
        "article": ShareArticleFactory(name="Karotten"),
        "day": day,
        "variation": ShareTypeVariationFactory(
            share_type=ShareTypeFactory(share_option=HARVEST)
        ),
    }


def _plan(api_client, setup, amount):
    return api_client.post(
        reverse("harvest_share_planning-list"),
        {
            "year": YEAR,
            "delivery_week": WEEK,
            "share_article": str(setup["article"].id),
            "unit": "PCS",
            "size": "M",
            f"day_{setup['day'].id}_variation_{setup['variation'].id}": amount,
        },
        format="json",
    )


@pytest.mark.django_db
class TestPlanningArchiveWindow:
    def test_lists_a_row_planned_months_before_its_week(self, api_client, setup):
        planned = _plan(api_client, setup, "13")
        assert planned.status_code == status.HTTP_200_OK, planned.data
        ShareContent.objects.filter(share_article=setup["article"]).update(
            created_at=timezone.now() - datetime.timedelta(days=120)
        )

        resp = api_client.get(
            reverse("harvest_share_planning-list"),
            {
                "year": YEAR,
                "delivery_week": WEEK,
                "share_option": HARVEST,
                "is_past": "false",
            },
        )

        assert resp.status_code == status.HTTP_200_OK
        assert planned.data["id"] in [row["id"] for row in resp.data]

    def test_refuses_planning_a_listed_slot_a_second_time(self, api_client, setup):
        assert _plan(api_client, setup, "13").status_code == status.HTTP_200_OK

        resp = _plan(api_client, setup, "5")

        assert resp.status_code == status.HTTP_409_CONFLICT
        assert resp.json()["code"] == "share_content.already_planned"
        assert ShareContent.objects.filter(share_article=setup["article"]).count() == 1
