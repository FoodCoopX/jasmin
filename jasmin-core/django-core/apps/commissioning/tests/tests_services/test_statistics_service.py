"""Tests for statistics (historical share variation averages)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from apps.commissioning.models import Share
from apps.commissioning.services.statistics import (
    calculate_historical_share_type_variation_averages,
)
from apps.commissioning.tests.factories import (
    DeliveryStationDayFactory,
    DeliveryStationFactory,
    ShareArticleFactory,
    ShareContentFactory,
    ShareFactory,
    SharesDeliveryDayFactory,
    ShareTypeVariationFactory,
)


# ---------------------------------------------------------------------------
# calculate_historical_share_type_variation_averages (multiple)
# ---------------------------------------------------------------------------
@pytest.mark.django_db
class TestCalculateHistoricalAveragesMultiple:
    def test_combines_multiple_variations(self, tenant):
        v1 = ShareTypeVariationFactory()
        v2 = ShareTypeVariationFactory()

        result = calculate_historical_share_type_variation_averages(
            [v1.pk, v2.pk], 2026, 15
        )
        # With no data, should return empty
        assert result == {}

    def test_skips_nonexistent_variations(self, tenant):
        result = calculate_historical_share_type_variation_averages([999999], 2026, 15)
        assert result == {}


@pytest.mark.django_db
class TestHistoricalAveragesFigures:
    """The averages at their three levels: per station the mean over the weeks
    it received the variation of that week's kilos, per tour and per day the
    sum of their stations' means."""

    def test_averages_each_station_then_adds_up_tours_and_the_day(self, tenant):
        day = SharesDeliveryDayFactory(day_number=2)
        station_a = DeliveryStationDayFactory(delivery_day=day, tour_number=1)
        station_b = DeliveryStationDayFactory(delivery_day=day, tour_number=1)
        station_c = DeliveryStationDayFactory(delivery_day=day, tour_number=2)
        # A station without a station-day on this day, so on no tour of it.
        station_d = DeliveryStationFactory()
        variation = ShareTypeVariationFactory()
        article = ShareArticleFactory(
            kg_per_piece_M=Decimal("0.500"), kg_per_bunch_S=Decimal("0.200")
        )

        def content(year_week, delivery_station, amount, unit="KG", size="M"):
            share, _ = Share.objects.get_or_create(
                year=year_week[0],
                delivery_week=year_week[1],
                delivery_day=day,
                share_type_variation=variation,
            )
            ShareContentFactory(
                share=share,
                share_article=article,
                delivery_station=delivery_station,
                amount=Decimal(amount),
                unit=unit,
                size=size,
            )

        # Week 10: station A gets 5 kg, 2 pieces of 0.5 kg and 3 litres (no
        # weight), station B 3 bunches of 0.2 kg. Week 11: A 4 kg, C 10 kg.
        content((2025, 10), station_a.delivery_station, "5")
        content((2025, 10), station_a.delivery_station, "2", unit="PCS")
        content((2025, 10), station_a.delivery_station, "3", unit="L")
        content((2025, 10), station_b.delivery_station, "3", unit="BUNCH", size="S")
        content((2025, 11), station_a.delivery_station, "4")
        content((2025, 11), station_c.delivery_station, "10")
        content((2025, 11), station_d, "2")
        # Neither counts: the current week, and a year past ``years_back``.
        content((2026, 15), station_a.delivery_station, "90")
        content((2023, 30), station_a.delivery_station, "90")

        result = calculate_historical_share_type_variation_averages(
            [variation.pk], 2026, 15
        )

        prefix = f"day_{day.pk}_variation_{variation.pk}"
        assert result == {
            f"{prefix}_station_{station_a.delivery_station_id}": 5.0,
            f"{prefix}_station_{station_b.delivery_station_id}": 0.6,
            f"{prefix}_station_{station_c.delivery_station_id}": 10.0,
            f"{prefix}_station_{station_d.pk}": 2.0,
            f"{prefix}_tour_1": 5.6,
            f"{prefix}_tour_2": 10.0,
            # Station D counts in the day, though in no tour.
            prefix: 17.6,
        }


# ---------------------------------------------------------------------------
# Query-count regression lock
# ---------------------------------------------------------------------------
@pytest.mark.django_db
class TestHistoricalAveragesQueryCount:
    """Adding variations must not add proportional queries: the whole batch is
    one ShareContent scan plus one tour lookup, not one scan (and a point
    lookup) per variation."""

    def _make_variation_with_content(self, delivery_day, dsd):
        variation = ShareTypeVariationFactory()
        share = ShareFactory(
            year=2025,
            delivery_week=10,
            delivery_day=delivery_day,
            share_type_variation=variation,
        )
        ShareContentFactory(
            share=share,
            delivery_station=dsd.delivery_station,
            amount=Decimal("5"),
            unit="KG",
            size="M",
        )
        return variation.pk

    def test_scan_is_batched_across_variations(self, tenant):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        delivery_day = SharesDeliveryDayFactory(day_number=2)
        dsd = DeliveryStationDayFactory(delivery_day=delivery_day, tour_number=1)

        few_ids = [
            self._make_variation_with_content(delivery_day, dsd) for _ in range(2)
        ]
        with CaptureQueriesContext(connection) as ctx_small:
            calculate_historical_share_type_variation_averages(few_ids, 2026, 15)
        small = len(ctx_small.captured_queries)

        many_ids = few_ids + [
            self._make_variation_with_content(delivery_day, dsd) for _ in range(6)
        ]
        with CaptureQueriesContext(connection) as ctx_large:
            calculate_historical_share_type_variation_averages(many_ids, 2026, 15)
        large = len(ctx_large.captured_queries)

        assert large - small <= 2, (
            f"historical averages N+1 suspected: 2 variations -> {small} queries, "
            f"8 variations -> {large} queries (delta {large - small})."
        )
