"""A delivery station needs a short name or a company name.

Every station list and selector shows a station by one of the two, so the
server refuses a write that would leave it with neither. A partial update is
judged together with the stored values, and one that sends neither field
passes, so a station stored without a name stays editable.
"""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status

from apps.commissioning.models import DeliveryStation
from apps.commissioning.tests.factories import (
    ContactEntityFactory,
    DeliveryStationFactory,
)

CODE = "delivery_station.name_required"
LIST_URL = reverse("delivery_station-list")


def _patch(api_client, station, payload):
    return api_client.patch(
        reverse("delivery_station-detail", kwargs={"pk": station.pk}),
        payload,
        format="json",
    )


@pytest.mark.django_db
class TestDeliveryStationName:
    @pytest.mark.parametrize(
        "payload",
        [{}, {"short_name": "  "}, {"short_name": None, "company_name": ""}],
    )
    def test_a_new_station_without_a_name_is_refused(self, api_client, tenant, payload):
        before = DeliveryStation.objects.count()

        resp = api_client.post(LIST_URL, payload, format="json")

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.json()["code"] == CODE
        assert DeliveryStation.objects.count() == before

    @pytest.mark.parametrize(
        "payload",
        [
            {"short_name": "North"},
            {
                "company_name": "Farm shop",
                "address": "Main St 1",
                "zip_code": "1010",
                "city": "Vienna",
            },
        ],
    )
    def test_a_short_name_or_a_company_name_is_enough(
        self, api_client, tenant, payload
    ):
        resp = api_client.post(LIST_URL, payload, format="json")

        assert resp.status_code == status.HTTP_201_CREATED, resp.content

    def test_clearing_the_only_name_is_refused(self, api_client, tenant):
        station = DeliveryStationFactory(short_name="North")

        resp = _patch(api_client, station, {"short_name": ""})

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.json()["code"] == CODE
        station.refresh_from_db()
        assert station.short_name == "North"

    def test_the_short_name_can_go_while_the_company_name_stays(
        self, api_client, tenant
    ):
        station = DeliveryStationFactory(
            short_name="North", contact=ContactEntityFactory(company_name="Farm shop")
        )

        resp = _patch(api_client, station, {"short_name": ""})

        assert resp.status_code == status.HTTP_200_OK, resp.content

    def test_a_station_stored_without_a_name_stays_editable(self, api_client, tenant):
        station = DeliveryStationFactory(short_name=None)

        resp = _patch(api_client, station, {"is_active": False})

        assert resp.status_code == status.HTTP_200_OK, resp.content
        station.refresh_from_db()
        assert station.is_active is False
