"""Tests for ``calculate_share_weights_by_week`` and the
``share_weights_by_week`` statistics endpoint: the weights taken of the
shares, averaged per share and then per ISO week and share type variation,
next to the variation's target weight; and for
``calculate_share_weights_summary`` and ``share_weights_summary``: the same
range's weighed boxes per share type size (each weight taken of a share one
box), with their average, spread and summed difference from the target.

The weeks are fixed in 2025 and 2026, so the ISO-week math is deterministic;
nothing here reads the clock.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.commissioning.models import ShareType
from apps.commissioning.services import (
    calculate_share_weights_by_week,
    calculate_share_weights_summary,
)
from apps.commissioning.tests.factories import (
    JasminUserFactory,
    ShareFactory,
    SharesDeliveryDayFactory,
    ShareTypeFactory,
    ShareTypeVariationFactory,
)

# ISO week 15 of 2026 spans Mon 2026-04-06 … Sun 2026-04-12; week 16 the week
# after.
WEEK_15_MONDAY = date(2026, 4, 6)
WEEK_15_WEDNESDAY = date(2026, 4, 8)
WEEK_16_SUNDAY = date(2026, 4, 19)
# 1 January 2026 is a Thursday, so ISO week 1 of 2026 starts on Monday
# 29 December 2025: this range covers 2025's week 52 and 2026's weeks 1 and 2.
WEEK_52_OF_2025_MONDAY = date(2025, 12, 22)
WEEK_2_OF_2026_SUNDAY = date(2026, 1, 11)

URL = "/api/commissioning/share_weights_by_week/"
SUMMARY_URL = "/api/commissioning/share_weights_summary/"


@pytest.fixture
def share(tenant):
    # One delivery day per weekday, shared by the test's shares: a delivery
    # day per share would overlap the next.
    days: dict[int, object] = {}

    def make(
        variation, *weights, year: int = 2026, week: int = 15, day_number: int = 2
    ):
        """The share of ``variation`` delivered on ``day_number`` of ``week``,
        with the weights taken of it, the rest left empty."""
        if day_number not in days:
            days[day_number] = SharesDeliveryDayFactory(day_number=day_number)
        taken = (list(weights) + [None] * 4)[:4]
        return ShareFactory(
            year=year,
            delivery_week=week,
            delivery_day=days[day_number],
            share_type_variation=variation,
            weight1=taken[0],
            weight2=taken[1],
            weight3=taken[2],
            weight4=taken[3],
        )

    return make


@pytest.mark.django_db
class TestShareWeightsByWeek:
    def test_averages_each_share_then_the_week(self, tenant, share):
        variation = ShareTypeVariationFactory(average_weight=Decimal("2.500"))
        # Wednesday's share weighs 2.4 and 2.6, so 2.5; Friday's weighs 2.2.
        share(variation, Decimal("2.400"), Decimal("2.600"))
        share(variation, Decimal("2.200"), day_number=4)

        [row] = calculate_share_weights_by_week(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert row == {
            "year": 2026,
            "week": 15,
            "share_type_variation": variation.pk,
            "share_type": variation.share_type_id,
            "share_type_name": variation.share_type.name,
            "share_type_rank": 0,
            "size": variation.size,
            "variation_rank": 0,
            "target_weight": Decimal("2.500"),
            "weighed_shares": 2,
            "average_weight": Decimal("2.350"),
        }

    def test_leaves_out_empty_and_zero_weights(self, tenant, share):
        variation = ShareTypeVariationFactory()
        share(variation, Decimal("3.000"), Decimal("0.000"), None, Decimal("4.000"))

        [row] = calculate_share_weights_by_week(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert row["average_weight"] == Decimal("3.500")
        assert row["weighed_shares"] == 1

    def test_rounds_the_average_to_three_decimals(self, tenant, share):
        variation = ShareTypeVariationFactory()
        share(variation, Decimal("1.000"), Decimal("1.000"), Decimal("2.000"))

        [row] = calculate_share_weights_by_week(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert row["average_weight"] == Decimal("1.333")

    def test_keeps_a_delivered_week_nobody_weighed(self, tenant, share):
        variation = ShareTypeVariationFactory(average_weight=None)
        share(variation)

        [row] = calculate_share_weights_by_week(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert row["average_weight"] is None
        assert row["weighed_shares"] == 0
        assert row["target_weight"] is None

    def test_orders_a_week_by_share_type_sort_order_and_size(self, tenant, share):
        vegetables = ShareTypeFactory(is_additional_share_type=False)
        eggs = ShareTypeFactory(
            share_option="CHICKEN_SHARE", is_additional_share_type=True
        )
        # Created out of order: the additional share type first, the larger
        # size before the smaller one.
        egg_box = ShareTypeVariationFactory(share_type=eggs, size="M")
        large = ShareTypeVariationFactory(share_type=vegetables, size="L", sort_order=2)
        small = ShareTypeVariationFactory(share_type=vegetables, size="S", sort_order=1)
        for variation in (egg_box, large, small):
            share(variation, Decimal("2.000"))
        share(small, Decimal("2.100"), week=16)

        rows = calculate_share_weights_by_week(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert [
            (
                row["week"],
                row["share_type_variation"],
                row["share_type_rank"],
                row["variation_rank"],
            )
            for row in rows
        ] == [
            (15, small.pk, 0, 0),
            (15, large.pk, 0, 1),
            (15, egg_box.pk, 1, 2),
            (16, small.pk, 0, 0),
        ]

    def test_leaves_out_the_variations_packed_in_bulk(self, tenant, share):
        boxed = ShareTypeVariationFactory(is_packed_bulk=False)
        bulk = ShareTypeVariationFactory(is_packed_bulk=True)
        share(boxed, Decimal("2.000"))
        share(bulk, Decimal("4.000"))

        rows = calculate_share_weights_by_week(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert [row["share_type_variation"] for row in rows] == [boxed.pk]

    def test_leaves_out_virtual_variations(self, tenant, share):
        physical = ShareTypeVariationFactory()
        virtual = ShareTypeVariationFactory(variation_type="virtual")
        share(physical, Decimal("2.000"))
        share(virtual, Decimal("4.000"))

        rows = calculate_share_weights_by_week(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert [row["share_type_variation"] for row in rows] == [physical.pk]

    def test_counts_only_the_weeks_of_the_range(self, tenant, share):
        variation = ShareTypeVariationFactory()
        share(variation, Decimal("2.000"), week=14)
        share(variation, Decimal("2.000"), week=17)
        share(variation, Decimal("2.000"), week=15)

        rows = calculate_share_weights_by_week(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert [row["week"] for row in rows] == [15]

    def test_counts_only_the_weeks_of_a_range_across_new_year(self, tenant, share):
        variation = ShareTypeVariationFactory()
        for year, week in [(2025, 1), (2025, 52), (2026, 1), (2026, 2), (2026, 52)]:
            share(variation, Decimal("2.000"), year=year, week=week)

        rows = calculate_share_weights_by_week(
            WEEK_52_OF_2025_MONDAY, WEEK_2_OF_2026_SUNDAY
        )

        assert [(row["year"], row["week"]) for row in rows] == [
            (2025, 52),
            (2026, 1),
            (2026, 2),
        ]

    def test_a_start_in_mid_week_takes_in_the_whole_week(self, tenant, share):
        variation = ShareTypeVariationFactory()
        share(variation, Decimal("2.000"), week=15)

        rows = calculate_share_weights_by_week(WEEK_15_WEDNESDAY, WEEK_16_SUNDAY)

        assert [row["week"] for row in rows] == [15]


@pytest.mark.django_db
class TestShareWeightsByWeekEndpoint:
    def test_returns_the_weights_as_strings(self, api_client, share):
        variation = ShareTypeVariationFactory(average_weight=Decimal("2.500"))
        share(variation, Decimal("2.450"))

        response = api_client.get(
            URL, {"start_date": "2026-04-06", "end_date": "2026-04-12"}
        )

        assert response.status_code == 200
        assert response.json() == [
            {
                "year": 2026,
                "week": 15,
                "share_type_variation": variation.pk,
                "share_type": variation.share_type_id,
                "share_type_name": variation.share_type.name,
                "share_type_rank": 0,
                "size": variation.size,
                "variation_rank": 0,
                "target_weight": "2.500",
                "weighed_shares": 1,
                "average_weight": "2.450",
            }
        ]

    def test_serves_a_weight_typed_in_grams(self, api_client, share):
        # A weight field takes up to seven digits before the point, so a box
        # weighed in grams by mistake still has to come back.
        variation = ShareTypeVariationFactory(average_weight=Decimal("2.500"))
        share(variation, Decimal("2450.000"))

        response = api_client.get(
            URL, {"start_date": "2026-04-06", "end_date": "2026-04-12"}
        )

        assert response.status_code == 200
        assert response.json()[0]["average_weight"] == "2450.000"

    def test_requires_date_params(self, api_client):
        assert api_client.get(URL).status_code == 400

    def test_rejects_a_span_beyond_the_cap(self, api_client):
        response = api_client.get(
            URL, {"start_date": "2020-01-06", "end_date": "2026-04-12"}
        )

        assert response.status_code == 400
        assert response.json()["field"] == "end_date"

    def test_is_for_the_office_only(self, tenant):
        client = APIClient()
        client.force_authenticate(user=JasminUserFactory(roles=["staff"]))

        response = client.get(
            URL, {"start_date": "2026-04-06", "end_date": "2026-04-12"}
        )

        assert response.status_code == 403

    def test_requires_authentication(self, anon_client):
        response = anon_client.get(
            URL, {"start_date": "2026-04-06", "end_date": "2026-04-12"}
        )

        assert response.status_code in (401, 403)


@pytest.mark.django_db
class TestShareWeightsSummary:
    def test_averages_the_weighed_boxes_with_their_spread_and_difference(
        self, tenant, share
    ):
        variation = ShareTypeVariationFactory(average_weight=Decimal("2.500"))
        # Four boxes: 2.4 and 2.6 on Wednesday, 2.2 on Friday, 2.9 a week on.
        share(variation, Decimal("2.400"), Decimal("2.600"))
        share(variation, Decimal("2.200"), day_number=4)
        share(variation, Decimal("2.900"), week=16)

        [row] = calculate_share_weights_summary(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert row == {
            "share_type_variation": variation.pk,
            "share_type_name": variation.share_type.name,
            "size": variation.size,
            "target_weight": Decimal("2.500"),
            "weighed_boxes": 4,
            "average_weight": Decimal("2.525"),
            "standard_deviation": Decimal("0.299"),
            # -0.1 + 0.1 - 0.3 + 0.4
            "total_difference_from_target": Decimal("0.100"),
        }

    def test_counts_each_box_weighed_on_a_delivery_day(self, tenant, share):
        variation = ShareTypeVariationFactory(average_weight=Decimal("2.400"))
        share(
            variation,
            Decimal("2.300"),
            Decimal("2.500"),
            Decimal("2.700"),
            Decimal("2.500"),
        )

        [row] = calculate_share_weights_summary(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert row["weighed_boxes"] == 4
        assert row["average_weight"] == Decimal("2.500")
        assert row["standard_deviation"] == Decimal("0.163")
        assert row["total_difference_from_target"] == Decimal("0.400")

    def test_one_weighed_share_has_no_deviation(self, tenant, share):
        variation = ShareTypeVariationFactory(average_weight=Decimal("2.500"))
        share(variation, Decimal("2.300"))

        [row] = calculate_share_weights_summary(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert row["standard_deviation"] is None
        assert row["total_difference_from_target"] == Decimal("-0.200")

    def test_without_a_target_there_is_no_difference(self, tenant, share):
        variation = ShareTypeVariationFactory(average_weight=None)
        share(variation, Decimal("2.300"))

        [row] = calculate_share_weights_summary(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert row["target_weight"] is None
        assert row["total_difference_from_target"] is None
        assert row["average_weight"] == Decimal("2.300")

    def test_keeps_a_size_delivered_but_never_weighed(self, tenant, share):
        variation = ShareTypeVariationFactory(average_weight=Decimal("2.500"))
        share(variation)

        [row] = calculate_share_weights_summary(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert row["weighed_boxes"] == 0
        assert row["average_weight"] is None
        assert row["standard_deviation"] is None
        assert row["total_difference_from_target"] is None

    def test_a_successor_variation_adds_to_its_size_against_its_own_target(
        self, tenant, share
    ):
        vegetables = ShareTypeFactory()
        until_week_15 = ShareTypeVariationFactory(
            share_type=vegetables,
            size="M",
            average_weight=Decimal("2.500"),
            valid_from=date(2026, 1, 5),
            valid_until=date(2026, 4, 12),
        )
        from_week_16 = ShareTypeVariationFactory(
            share_type=vegetables,
            size="M",
            average_weight=Decimal("3.000"),
            valid_from=date(2026, 4, 13),
        )
        share(until_week_15, Decimal("2.600"))
        share(from_week_16, Decimal("2.800"), week=16)

        [row] = calculate_share_weights_summary(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        # Both variations share the order's keys up to their ids.
        assert row["share_type_variation"] == min(until_week_15.pk, from_week_16.pk)
        # The target shown is the latest variation's; the sum takes each
        # box against its own: 2.6 - 2.5 and 2.8 - 3.0.
        assert row["target_weight"] == Decimal("3.000")
        assert row["total_difference_from_target"] == Decimal("-0.100")
        assert row["weighed_boxes"] == 2
        assert row["average_weight"] == Decimal("2.700")
        assert row["standard_deviation"] == Decimal("0.141")

    def test_continues_a_size_into_next_seasons_share_type_of_the_same_name(
        self, tenant, share
    ):
        this_season = ShareTypeFactory(
            share_option="BREAD_SHARE", name="Bread", valid_until=date(2026, 4, 12)
        )
        next_season = ShareType.objects.create(
            share_option="BREAD_SHARE",
            name="Bread",
            valid_from=date(2026, 4, 13),
            delivery_cycle="WEEKLY",
        )
        loaf = ShareTypeVariationFactory(
            share_type=this_season,
            size="S",
            average_weight=Decimal("1.000"),
            valid_until=date(2026, 4, 12),
        )
        next_loaf = ShareTypeVariationFactory(
            share_type=next_season,
            size="S",
            average_weight=Decimal("1.200"),
            valid_from=date(2026, 4, 13),
        )
        share(loaf, Decimal("1.100"))
        share(next_loaf, Decimal("1.300"), week=16)

        rows = calculate_share_weights_summary(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        [row] = rows
        assert row["share_type_variation"] in {loaf.pk, next_loaf.pk}
        assert row["weighed_boxes"] == 2
        assert row["target_weight"] == Decimal("1.200")
        # 1.1 - 1.0 and 1.3 - 1.2
        assert row["total_difference_from_target"] == Decimal("0.200")

    def test_keeps_the_same_size_of_two_unnamed_share_types_apart(self, tenant, share):
        oil = ShareTypeFactory(share_option="OIL_SHARE", name=None)
        grain = ShareTypeFactory(share_option="GRAIN_SHARE", name=None)
        oil_bottle = ShareTypeVariationFactory(share_type=oil, size="S")
        grain_bag = ShareTypeVariationFactory(share_type=grain, size="S")
        share(oil_bottle, Decimal("0.750"))
        share(grain_bag, Decimal("1.000"))

        rows = calculate_share_weights_summary(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert {row["share_type_variation"] for row in rows} == {
            oil_bottle.pk,
            grain_bag.pk,
        }
        assert [row["share_type_name"] for row in rows] == ["", ""]

    def test_keeps_the_same_size_of_two_share_types_apart_in_order(self, tenant, share):
        vegetables = ShareTypeFactory(is_additional_share_type=False)
        eggs = ShareTypeFactory(
            share_option="CHICKEN_SHARE", is_additional_share_type=True
        )
        egg_box = ShareTypeVariationFactory(share_type=eggs, size="S")
        small = ShareTypeVariationFactory(share_type=vegetables, size="S")
        share(egg_box, Decimal("0.600"))
        share(small, Decimal("2.000"))

        rows = calculate_share_weights_summary(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert [row["share_type_variation"] for row in rows] == [small.pk, egg_box.pk]

    def test_leaves_out_the_variations_not_packed_in_boxes(self, tenant, share):
        boxed = ShareTypeVariationFactory()
        share(boxed, Decimal("2.000"))
        share(ShareTypeVariationFactory(is_packed_bulk=True), Decimal("4.000"))
        share(ShareTypeVariationFactory(variation_type="virtual"), Decimal("4.000"))

        rows = calculate_share_weights_summary(WEEK_15_MONDAY, WEEK_16_SUNDAY)

        assert [row["share_type_variation"] for row in rows] == [boxed.pk]


@pytest.mark.django_db
class TestShareWeightsSummaryEndpoint:
    def test_returns_the_figures_as_strings(self, api_client, share):
        variation = ShareTypeVariationFactory(average_weight=Decimal("2.500"))
        share(variation, Decimal("2.450"))
        share(variation, Decimal("2.650"), day_number=4)

        response = api_client.get(
            SUMMARY_URL, {"start_date": "2026-04-06", "end_date": "2026-04-12"}
        )

        assert response.status_code == 200
        assert response.json() == [
            {
                "share_type_variation": variation.pk,
                "share_type_name": variation.share_type.name,
                "size": variation.size,
                "target_weight": "2.500",
                "weighed_boxes": 2,
                "average_weight": "2.550",
                "standard_deviation": "0.141",
                "total_difference_from_target": "0.100",
            }
        ]

    def test_rejects_a_span_beyond_the_cap(self, api_client):
        response = api_client.get(
            SUMMARY_URL, {"start_date": "2020-01-06", "end_date": "2026-04-12"}
        )

        assert response.status_code == 400
        assert response.json()["field"] == "end_date"

    def test_is_for_the_office_only(self, tenant):
        client = APIClient()
        client.force_authenticate(user=JasminUserFactory(roles=["staff"]))

        response = client.get(
            SUMMARY_URL, {"start_date": "2026-04-06", "end_date": "2026-04-12"}
        )

        assert response.status_code == 403
