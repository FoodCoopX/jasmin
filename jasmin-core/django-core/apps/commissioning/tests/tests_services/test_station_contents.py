"""Tests for the station contents, the members' notice at a delivery station."""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse

from apps.commissioning.models import (
    ExternalShareDemand,
    ShareImportBatch,
    VirtualVariationComponent,
)
from apps.commissioning.services.share_demand_service import ExternalDemandBackend
from apps.commissioning.services.station_contents import get_station_contents
from apps.commissioning.tests.factories import (
    DeliveryStationDayFactory,
    MemberFactory,
    ResellerFactory,
    ShareArticleFactory,
    ShareContentFactory,
    ShareDeliveryFactory,
    ShareFactory,
    SharesDeliveryDayFactory,
    ShareTypeFactory,
    ShareTypeVariationFactory,
    SubscriptionFactory,
)

_YEAR = 2026
_WEEK = 15
_DAY = 2


def _share(variation, delivery_day):
    share = ShareFactory(
        year=_YEAR,
        delivery_week=_WEEK,
        delivery_day=delivery_day,
        share_type_variation=variation,
    )
    share.packing_day = _DAY
    share.save()
    return share


def _content(share, station, article, amount, **fields):
    ShareContentFactory(
        share=share,
        share_article=article,
        delivery_station=station,
        amount=Decimal(amount),
        **{"unit": "KG", "size": "M", "note": "", **fields},
    )


def _collect(share, station_day, variation, joker_taken=False):
    subscription = SubscriptionFactory(
        member=MemberFactory(),
        share_type_variation=variation,
        quantity=1,
        default_delivery_station_day=station_day,
    )
    ShareDeliveryFactory(
        share=share,
        delivery_station_day=station_day,
        subscription=subscription,
        joker_taken=joker_taken,
    )


def _contents(station_day):
    return get_station_contents(
        year=_YEAR,
        delivery_week=_WEEK,
        day_number=_DAY,
        delivery_station=station_day.delivery_station_id,
        is_past=False,
    )


@pytest.mark.django_db
@pytest.mark.usefixtures("clock_in_factory_week")
class TestGetStationContents:
    def test_one_entry_per_collected_variation_with_its_per_share_amounts(self, tenant):
        day = SharesDeliveryDayFactory(day_number=_DAY, default_packing_day=_DAY)
        station_day = DeliveryStationDayFactory(delivery_day=day)
        station = station_day.delivery_station
        vegetables = ShareTypeFactory(share_option="HARVEST_SHARE", name="Gemüse")
        small = ShareTypeVariationFactory(
            share_type=vegetables, size="S", sort_order=1, is_packed_bulk=False
        )
        large = ShareTypeVariationFactory(
            share_type=vegetables, size="L", sort_order=2, is_packed_bulk=True
        )
        carrots = ShareArticleFactory(name="Karotten")
        leek = ShareArticleFactory(name="Lauch")
        small_share = _share(small, day)
        large_share = _share(large, day)
        _content(small_share, station, carrots, "0.5")
        _content(large_share, station, carrots, "1")
        _content(large_share, station, leek, "2", unit="PCS")
        _collect(small_share, station_day, small)
        _collect(large_share, station_day, large)

        shares = _contents(station_day)["shares"]

        assert [share["variation_id"] for share in shares] == [small.pk, large.pk]
        assert [share["is_packed_bulk"] for share in shares] == [False, True]
        assert shares[0]["share_type_name"] == "Gemüse"
        assert shares[0]["size"] == "S"
        assert [
            (item["share_article_name"], item["amount"], item["unit"])
            for item in shares[0]["items"]
        ] == [("Karotten", Decimal("0.5"), "KG")]
        assert {item["share_article_name"] for item in shares[1]["items"]} == {
            "Karotten",
            "Lauch",
        }

    def test_each_share_carries_its_own_note_on_an_article(self, tenant):
        day = SharesDeliveryDayFactory(day_number=_DAY, default_packing_day=_DAY)
        station_day = DeliveryStationDayFactory(delivery_day=day)
        station = station_day.delivery_station
        vegetables = ShareTypeFactory(share_option="HARVEST_SHARE")
        small = ShareTypeVariationFactory(share_type=vegetables, size="S", sort_order=1)
        large = ShareTypeVariationFactory(share_type=vegetables, size="L", sort_order=2)
        pumpkins = ShareArticleFactory(name="Kürbis")
        small_share = _share(small, day)
        large_share = _share(large, day)
        _content(small_share, station, pumpkins, "1", unit="PCS")
        _content(large_share, station, pumpkins, "2", unit="PCS", note="the big ones")
        _collect(small_share, station_day, small)
        _collect(large_share, station_day, large)

        shares = _contents(station_day)["shares"]

        assert [share["items"][0]["note"] for share in shares] == ["", "the big ones"]

    def test_each_share_names_its_own_seller_for_members(self, tenant):
        day = SharesDeliveryDayFactory(day_number=_DAY, default_packing_day=_DAY)
        station_day = DeliveryStationDayFactory(delivery_day=day)
        station = station_day.delivery_station
        fruit = ShareTypeFactory(share_option="HARVEST_SHARE")
        small = ShareTypeVariationFactory(share_type=fruit, size="S", sort_order=1)
        large = ShareTypeVariationFactory(share_type=fruit, size="L", sort_order=2)
        cherries = ShareArticleFactory(name="Kirschen Zukauf")
        small_share = _share(small, day)
        large_share = _share(large, day)
        _content(
            small_share,
            station,
            cherries,
            "0.5",
            seller=ResellerFactory(
                is_seller=True, name_for_member_pages="Obsthof Huber"
            ),
        )
        _content(large_share, station, cherries, "1")
        _collect(small_share, station_day, small)
        _collect(large_share, station_day, large)

        shares = _contents(station_day)["shares"]

        assert [
            share["items"][0]["seller_name_for_member_pages"] for share in shares
        ] == [
            "Obsthof Huber",
            "",
        ]

    def test_each_article_carries_its_organic_status(self, tenant):
        day = SharesDeliveryDayFactory(day_number=_DAY, default_packing_day=_DAY)
        station_day = DeliveryStationDayFactory(delivery_day=day)
        variation = ShareTypeVariationFactory(size="M", sort_order=1)
        share = _share(variation, day)
        _content(
            share,
            station_day.delivery_station,
            ShareArticleFactory(name="Brot", organic_status="organic"),
            "1",
            unit="PCS",
        )
        _content(
            share,
            station_day.delivery_station,
            ShareArticleFactory(name="Karotten", organic_status="conventional"),
            "1",
        )
        _collect(share, station_day, variation)

        [share_entry] = _contents(station_day)["shares"]

        assert {
            item["share_article_name"]: item["organic_status"]
            for item in share_entry["items"]
        } == {"Brot": "organic", "Karotten": "conventional"}

    def test_a_variation_nobody_collects_at_the_station_is_left_out(self, tenant):
        """Planned contents reach every station of the day; the notice still
        shows only the shares collected at this one."""
        day = SharesDeliveryDayFactory(day_number=_DAY, default_packing_day=_DAY)
        station_day = DeliveryStationDayFactory(delivery_day=day)
        other_station_day = DeliveryStationDayFactory(delivery_day=day)
        vegetables = ShareTypeVariationFactory(size="M", sort_order=1)
        fruit = ShareTypeVariationFactory(
            share_type=ShareTypeFactory(
                share_option="HARVEST_SHARE_FRUIT", is_additional_share_type=True
            ),
            size="M",
            sort_order=1,
        )
        vegetables_share = _share(vegetables, day)
        fruit_share = _share(fruit, day)
        _content(
            vegetables_share, station_day.delivery_station, ShareArticleFactory(), "1"
        )
        _content(fruit_share, station_day.delivery_station, ShareArticleFactory(), "1")
        _collect(vegetables_share, station_day, vegetables)
        _collect(fruit_share, other_station_day, fruit)

        shares = _contents(station_day)["shares"]

        assert [share["variation_id"] for share in shares] == [vegetables.pk]

    def test_a_jokered_delivery_does_not_count_as_collected(self, tenant):
        day = SharesDeliveryDayFactory(day_number=_DAY, default_packing_day=_DAY)
        station_day = DeliveryStationDayFactory(delivery_day=day)
        variation = ShareTypeVariationFactory(size="M", sort_order=1)
        share = _share(variation, day)
        _content(share, station_day.delivery_station, ShareArticleFactory(), "1")
        _collect(share, station_day, variation, joker_taken=True)

        assert _contents(station_day)["shares"] == []

    def test_a_virtual_subscription_counts_as_its_physical_components(self, tenant):
        day = SharesDeliveryDayFactory(day_number=_DAY, default_packing_day=_DAY)
        station_day = DeliveryStationDayFactory(delivery_day=day)
        station = station_day.delivery_station
        vegetables = ShareTypeFactory(share_option="HARVEST_SHARE")
        medium = ShareTypeVariationFactory(
            share_type=vegetables, size="M", sort_order=1
        )
        small = ShareTypeVariationFactory(share_type=vegetables, size="S", sort_order=2)
        large = ShareTypeVariationFactory(
            share_type=vegetables, size="L", sort_order=3, variation_type="virtual"
        )
        for physical in (medium, small):
            VirtualVariationComponent.objects.create(
                virtual_variation=large, physical_variation=physical, quantity=1
            )
        article = ShareArticleFactory()
        _content(_share(medium, day), station, article, "2")
        _content(_share(small, day), station, article, "1")
        _collect(_share(large, day), station_day, large)

        shares = _contents(station_day)["shares"]

        assert {share["variation_id"] for share in shares} == {medium.pk, small.pk}

    def test_imported_demand_decides_what_is_collected(self, tenant):
        """A tenant that imports its weekly demand has no deliveries; the
        imported demand at the station names the collected shares."""
        day = SharesDeliveryDayFactory(day_number=_DAY, default_packing_day=_DAY)
        station_day = DeliveryStationDayFactory(delivery_day=day)
        collected = ShareTypeVariationFactory(size="M", sort_order=1)
        not_collected = ShareTypeVariationFactory(
            share_type=collected.share_type, size="L", sort_order=2
        )
        for variation in (collected, not_collected):
            _content(
                _share(variation, day),
                station_day.delivery_station,
                ShareArticleFactory(),
                "1",
            )
        ExternalShareDemand.objects.create(
            batch=ShareImportBatch.objects.create(
                year=_YEAR,
                delivery_week=_WEEK,
                file_checksum="0" * 64,
                original_filename="seed.csv",
                status=ShareImportBatch.STATUS_APPLIED,
            ),
            year=_YEAR,
            delivery_week=_WEEK,
            delivery_station_day=station_day,
            share_type_variation=collected,
            quantity=4,
        )

        with patch(
            "apps.commissioning.services.share_demand_service._resolve_backend",
            return_value=ExternalDemandBackend(),
        ):
            shares = _contents(station_day)["shares"]

        assert [share["variation_id"] for share in shares] == [collected.pk]


@pytest.mark.django_db
@pytest.mark.usefixtures("clock_in_factory_week")
class TestStationContentsEndpoint:
    URL = reverse("packing_list-station-contents")

    def test_sends_the_amounts_as_decimal_strings(self, tenant, api_client):
        day = SharesDeliveryDayFactory(day_number=_DAY, default_packing_day=_DAY)
        station_day = DeliveryStationDayFactory(delivery_day=day)
        variation = ShareTypeVariationFactory(size="M", sort_order=1)
        share = _share(variation, day)
        _content(share, station_day.delivery_station, ShareArticleFactory(), "0.5")
        _collect(share, station_day, variation)

        response = api_client.get(
            self.URL,
            {
                "year": _YEAR,
                "delivery_week": _WEEK,
                "day_number": _DAY,
                "delivery_station": station_day.delivery_station_id,
            },
        )

        assert response.status_code == 200
        assert response.json()["shares"][0]["items"][0]["amount"] == "0.500"

    def test_refuses_a_request_without_a_station(self, tenant, api_client):
        response = api_client.get(
            self.URL, {"year": _YEAR, "delivery_week": _WEEK, "day_number": _DAY}
        )

        assert response.status_code == 400
