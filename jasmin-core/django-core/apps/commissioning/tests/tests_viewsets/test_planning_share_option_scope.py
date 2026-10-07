"""A planning row is one share option's slot, and every write stays inside it.

An article can belong to three share options, and each planning page lists
one, so the same article, unit and size is planned once per option. These
tests plan an article in both the harvest share and the fruit-only share, act
on the fruit row, and check that the harvest plan is untouched.
"""

from __future__ import annotations

import datetime
from decimal import Decimal
from unittest.mock import patch

import pytest
import time_machine
from django.urls import reverse
from rest_framework import status

from apps.commissioning.models import DefaultShareContent, ShareContent
from apps.commissioning.services.share_content_service import ShareContentService
from apps.commissioning.tests.factories import (
    DeliveryStationDayFactory,
    DeliveryStationFactory,
    ShareArticleFactory,
    SharesDeliveryDayFactory,
    ShareTypeFactory,
    ShareTypeVariationFactory,
)
from apps.commissioning.views.finalize_views import _get_finalization_status

YEAR, WEEK = 2026, 20
HARVEST, FRUIT = "HARVEST_SHARE", "HARVEST_SHARE_FRUIT"


@pytest.fixture(autouse=True)
def _frozen_clock():
    # A Monday ten weeks before the planned weeks, away from a year boundary.
    with time_machine.travel(datetime.datetime(2026, 3, 2, 12, 0), tick=False):
        yield


@pytest.fixture
def setup(tenant):
    """An article, one delivery day at one station, and a variation in each
    of the two share options."""
    day = SharesDeliveryDayFactory()
    DeliveryStationDayFactory(
        delivery_station=DeliveryStationFactory(is_active=True),
        delivery_day=day,
        tour_number=1,
    )
    return {
        "article": ShareArticleFactory(),
        "day": day,
        "harvest": ShareTypeVariationFactory(
            share_type=ShareTypeFactory(share_option=HARVEST)
        ),
        "fruit": ShareTypeVariationFactory(
            share_type=ShareTypeFactory(share_option=FRUIT)
        ),
    }


def _cell(setup, variation):
    return f"day_{setup['day'].id}_variation_{setup[variation].id}"


def _plan(api_client, setup, variation, amount):
    resp = api_client.post(
        reverse("harvest_share_planning-list"),
        {
            "year": YEAR,
            "delivery_week": WEEK,
            "share_article": str(setup["article"].id),
            "unit": "KG",
            "size": "M",
            _cell(setup, variation): amount,
        },
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK, resp.data
    return resp.data["id"]


def _planned(setup):
    """The article's planned amount per share option."""
    return {
        content.share.share_type_variation.share_type.share_option: content.amount
        for content in ShareContent.objects.filter(
            share_article=setup["article"]
        ).select_related("share__share_type_variation__share_type")
    }


@pytest.mark.django_db
class TestWeeklyPlanning:
    @pytest.fixture
    def rows(self, api_client, setup):
        return {
            HARVEST: _plan(api_client, setup, "harvest", "10"),
            FRUIT: _plan(api_client, setup, "fruit", "7"),
        }

    def test_each_option_lists_its_own_row(self, api_client, setup, rows):
        listed = {}
        for share_option in (HARVEST, FRUIT):
            resp = api_client.get(
                reverse("harvest_share_planning-list"),
                {"year": YEAR, "delivery_week": WEEK, "share_option": share_option},
            )
            listed[share_option] = [row["id"] for row in resp.data]

        assert rows[FRUIT].endswith(f"_KG_M_{FRUIT}")
        assert rows[HARVEST].endswith(f"_KG_M_{HARVEST}")
        assert rows[FRUIT] in listed[FRUIT]
        assert rows[FRUIT] not in listed[HARVEST]
        assert rows[HARVEST] in listed[HARVEST]

    def test_a_save_keeps_the_other_options_plan(self, api_client, setup, rows):
        resp = api_client.patch(
            reverse("harvest_share_planning-detail", args=[rows[FRUIT]]),
            {_cell(setup, "fruit"): "8"},
            format="json",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert resp.data["id"] == rows[FRUIT]
        assert _planned(setup) == {HARVEST: Decimal("10"), FRUIT: Decimal("8")}

    def test_a_delete_keeps_the_other_options_plan(self, api_client, setup, rows):
        resp = api_client.delete(
            reverse("harvest_share_planning-detail", args=[rows[FRUIT]])
        )

        assert resp.status_code == status.HTTP_200_OK
        assert _planned(setup) == {HARVEST: Decimal("10")}

    def test_a_backup_leaves_the_other_option_alone(self, api_client, setup, rows):
        backup_article = ShareArticleFactory()

        resp = api_client.put(
            reverse("harvest_share_planning-backup", args=[rows[FRUIT]]),
            {
                "backup_share_article": str(backup_article.id),
                "backup_unit": "KG",
                "backup_size": "M",
                _cell(setup, "fruit"): "2",
            },
            format="json",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        contents = ShareContent.objects.filter(share_article=setup["article"])
        fruit = contents.get(share__share_type_variation=setup["fruit"])
        harvest = contents.get(share__share_type_variation=setup["harvest"])
        assert fruit.backup_share_article_id == backup_article.id
        assert fruit.backup_amount == Decimal("2")
        assert harvest.backup_share_article_id is None
        assert not harvest.backup_amount

    def test_finalizing_leaves_the_other_option_open(self, api_client, setup, rows):
        resp = api_client.post(
            reverse("bulk_finalize_share_content"),
            {"ids": [rows[FRUIT]]},
            format="json",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert resp.data["finalization_status"] == {rows[FRUIT]: True}
        finalized = {
            content.share.share_type_variation_id: content.is_finalized
            for content in ShareContent.objects.filter(share_article=setup["article"])
        }
        assert finalized == {setup["fruit"].id: True, setup["harvest"].id: False}

    def test_an_id_without_the_option_asks_about_every_option(self, setup, rows):
        ShareContent.objects.filter(share__share_type_variation=setup["fruit"]).update(
            is_finalized=True
        )
        every_option = rows[FRUIT].removesuffix(f"_{FRUIT}")

        assert _get_finalization_status([rows[FRUIT], rows[HARVEST], every_option]) == {
            rows[FRUIT]: True,
            rows[HARVEST]: False,
            every_option: False,
        }

    def test_a_cell_of_another_option_is_refused(self, api_client, setup, rows):
        resp = api_client.patch(
            reverse("harvest_share_planning-detail", args=[rows[FRUIT]]),
            {_cell(setup, "harvest"): "5"},
            format="json",
        )

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.data["code"] == "share_content.variation_outside_share_option"
        assert resp.data["details"]["variation_ids"] == [setup["harvest"].id]
        assert _planned(setup) == {HARVEST: Decimal("10"), FRUIT: Decimal("7")}

    def test_an_id_without_the_option_is_still_accepted(self, api_client, setup, rows):
        resp = api_client.patch(
            reverse(
                "harvest_share_planning-detail",
                args=[rows[FRUIT].removesuffix(f"_{FRUIT}")],
            ),
            {_cell(setup, "fruit"): "8"},
            format="json",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert _planned(setup)[FRUIT] == Decimal("8")


@pytest.mark.django_db
class TestStockOnlyRows:
    def test_a_stock_only_row_names_its_share_option(self, tenant):
        article = ShareArticleFactory(share_option=FRUIT)
        stock = {(str(article.id), "KG", "M", "storage"): {"current_stock_amount": 5}}

        with patch(
            "apps.commissioning.services.share_content_frontend.StockService"
            ".get_theoretical_current_stock",
            return_value=stock,
        ):
            rows = ShareContentService._build_stock_only_rows(
                year=YEAR, delivery_week=WEEK, existing_rows=[], share_option=FRUIT
            )

        assert [row["id"] for row in rows] == [
            f"{YEAR}_{WEEK}_{article.id}_KG_M_{FRUIT}"
        ]


def _plan_long_term(api_client, setup, variation, share_option, amount):
    return api_client.post(
        reverse("default_share_contents-bulk-create"),
        {
            "year": YEAR,
            "share_article": str(setup["article"].id),
            "share_option": share_option,
            "unit": "KG",
            "size": "M",
            "range_1": WEEK,
            "range_2": WEEK + 1,
            f"amount_{setup[variation].id}": amount,
        },
        format="json",
    )


def _long_term_plan(setup):
    """The article's long-term amounts and planned share contents, per
    variation."""
    defaults = {
        (default.share_type_variation_id, default.delivery_week): default.amount
        for default in DefaultShareContent.objects.filter(
            share_article=setup["article"]
        )
    }
    contents = sorted(
        ShareContent.objects.filter(share_article=setup["article"]).values_list(
            "share__share_type_variation_id", "share__delivery_week", "amount"
        )
    )
    return defaults, contents


@pytest.mark.django_db
class TestLongTermPlanning:
    @pytest.fixture
    def rows(self, api_client, setup):
        ids = {}
        for variation, share_option, amount in (
            ("harvest", HARVEST, "3"),
            ("fruit", FRUIT, "2"),
        ):
            resp = _plan_long_term(api_client, setup, variation, share_option, amount)
            assert resp.status_code == status.HTTP_200_OK, resp.data
            ids[share_option] = resp.data["id"]
        return ids

    @staticmethod
    def _harvest_part(setup):
        defaults, contents = _long_term_plan(setup)
        harvest_id = setup["harvest"].id
        return (
            {key: amount for key, amount in defaults.items() if key[0] == harvest_id},
            [content for content in contents if content[0] == harvest_id],
        )

    def test_each_option_lists_its_own_row(self, api_client, setup, rows):
        listed = {}
        for share_option in (HARVEST, FRUIT):
            resp = api_client.get(
                reverse("default_share_contents-bulk-list"),
                {"year": YEAR, "share_option": share_option},
            )
            (listed[share_option],) = [
                row for row in resp.data if row["share_article"] == setup["article"].id
            ]

        assert listed[FRUIT]["id"] == rows[FRUIT]
        assert rows[FRUIT].endswith(f"_KG_M_{FRUIT}")
        assert f"amount_{setup['fruit'].id}" in listed[FRUIT]
        assert f"amount_{setup['harvest'].id}" not in listed[FRUIT]
        assert listed[HARVEST]["id"] == rows[HARVEST]
        assert f"amount_{setup['fruit'].id}" not in listed[HARVEST]

    def test_a_save_keeps_the_other_options_plan(self, api_client, setup, rows):
        harvest_before = self._harvest_part(setup)
        assert harvest_before[1], "the long-term plan should have planned weeks"

        resp = api_client.put(
            reverse("default_share_contents-bulk-update", args=[rows[FRUIT]]),
            {
                "share_option": FRUIT,
                "range_1": WEEK,
                "range_2": WEEK + 1,
                f"amount_{setup['fruit'].id}": "4",
            },
            format="json",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert resp.data["id"] == rows[FRUIT]
        assert self._harvest_part(setup) == harvest_before
        defaults, _contents = _long_term_plan(setup)
        assert defaults[(setup["fruit"].id, WEEK)] == Decimal("4")

    def test_a_delete_keeps_the_other_options_plan(self, api_client, setup, rows):
        harvest_before = self._harvest_part(setup)

        resp = api_client.delete(
            reverse("default_share_contents-bulk-delete", args=[rows[FRUIT]])
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert self._harvest_part(setup) == harvest_before
        defaults, contents = _long_term_plan(setup)
        assert all(key[0] != setup["fruit"].id for key in defaults)
        assert all(content[0] != setup["fruit"].id for content in contents)

    def test_a_save_with_another_options_amount_is_refused(
        self, api_client, setup, rows
    ):
        before = _long_term_plan(setup)

        resp = api_client.put(
            reverse("default_share_contents-bulk-update", args=[rows[FRUIT]]),
            {
                "share_option": FRUIT,
                "range_1": WEEK,
                "range_2": WEEK + 1,
                f"amount_{setup['harvest'].id}": "9",
            },
            format="json",
        )

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.data["code"] == "share_content.variation_outside_share_option"
        assert _long_term_plan(setup) == before
