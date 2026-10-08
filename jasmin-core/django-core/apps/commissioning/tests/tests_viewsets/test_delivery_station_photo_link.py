"""The office sets and clears a station's photo link.

Members see the uploaded picture, or this link when there is none, so the
office's station information modal edits it like the other text fields: an
emptied field arrives as ``""``.
"""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status

from apps.commissioning.tests.factories import DeliveryStationFactory

LINK = "https://example.com/station.jpg"


def _patch(api_client, station, value):
    return api_client.patch(
        reverse("delivery_station-detail", kwargs={"pk": station.pk}),
        {"photo_link": value},
        format="json",
    )


@pytest.mark.django_db
class TestDeliveryStationPhotoLink:
    def test_the_office_sets_a_link(self, api_client, tenant):
        station = DeliveryStationFactory()

        resp = _patch(api_client, station, LINK)

        assert resp.status_code == status.HTTP_200_OK, resp.data
        station.refresh_from_db()
        assert station.photo_link == LINK

    @pytest.mark.parametrize("cleared", ["", None])
    def test_the_office_clears_the_link(self, api_client, tenant, cleared):
        station = DeliveryStationFactory(photo_link=LINK)

        resp = _patch(api_client, station, cleared)

        assert resp.status_code == status.HTTP_200_OK, resp.data
        station.refresh_from_db()
        assert not station.photo_link
        assert not resp.data["photo_link"]
