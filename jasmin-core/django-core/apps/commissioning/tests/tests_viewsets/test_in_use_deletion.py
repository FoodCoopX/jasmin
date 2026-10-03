"""DELETE honours ``can_be_deleted`` on share types, plots, storages, share
articles, crates and order days.

The list reports ``can_be_deleted`` from the rows that still point at an
object; the delete refuses the same objects with a 409 instead of cascading
over those rows (a plot's forecasts, an article's price history, a crate's
prices) or failing on a protected one. An unused object still deletes.
"""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status

from apps.commissioning.models import (
    Crate,
    OrdersDeliveryDay,
    Plot,
    ShareArticle,
    ShareType,
    Storage,
)
from apps.commissioning.tests.factories import (
    CrateFactory,
    CrateNetPriceFactory,
    ForecastFactory,
    OrdersDeliveryDayFactory,
    PlotFactory,
    ShareArticleFactory,
    ShareArticleNetPriceFactory,
    ShareTypeFactory,
    ShareTypeVariationFactory,
    StorageFactory,
)

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("tenant")]


def _in_use_plot():
    plot = PlotFactory()
    ForecastFactory(plot=plot)
    return plot


def _in_use_storage():
    storage = StorageFactory()
    ForecastFactory(storage=storage)
    return storage


def _in_use_share_article():
    return ShareArticleNetPriceFactory().share_article


def _in_use_crate():
    return CrateNetPriceFactory().crate


def _in_use_share_type():
    return ShareTypeVariationFactory().share_type


IN_USE = [
    ("plots-detail", Plot, _in_use_plot, "plot.in_use"),
    ("storages-detail", Storage, _in_use_storage, "storage.in_use"),
    (
        "share_article-detail",
        ShareArticle,
        _in_use_share_article,
        "share_article.in_use",
    ),
    ("crates-detail", Crate, _in_use_crate, "crate.in_use"),
    ("share_type-detail", ShareType, _in_use_share_type, "share_type.in_use"),
]

UNUSED = [
    ("plots-detail", Plot, PlotFactory),
    ("storages-detail", Storage, StorageFactory),
    ("share_article-detail", ShareArticle, ShareArticleFactory),
    ("crates-detail", Crate, CrateFactory),
    ("share_type-detail", ShareType, ShareTypeFactory),
    ("orders_delivery_day-detail", OrdersDeliveryDay, OrdersDeliveryDayFactory),
]


@pytest.mark.parametrize(
    "route, model, make, code", IN_USE, ids=[row[0] for row in IN_USE]
)
def test_an_object_in_use_is_refused_and_kept(api_client, route, model, make, code):
    instance = make()

    resp = api_client.delete(reverse(route, args=[instance.pk]))

    assert resp.status_code == status.HTTP_409_CONFLICT, resp.data
    assert resp.data["code"] == code
    assert model.objects.filter(pk=instance.pk).exists()


@pytest.mark.parametrize("route, model, make", UNUSED, ids=[row[0] for row in UNUSED])
def test_an_unused_object_is_deleted(api_client, route, model, make):
    instance = make()

    resp = api_client.delete(reverse(route, args=[instance.pk]))

    assert resp.status_code == status.HTTP_204_NO_CONTENT
    assert not model.objects.filter(pk=instance.pk).exists()
