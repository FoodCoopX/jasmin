"""The harvest and purchase documentation refuse a week the pages show read-only.

A week turns read-only once it lies more than one week behind the current ISO
week; the week right after it is still the grace in which late entries go in.
The clock stands on Monday of ISO week 41 of 2026, so week 39 is read-only and
week 40 is the writable grace week.
"""

from __future__ import annotations

import datetime

import pytest
import time_machine
from django.urls import reverse
from rest_framework import status

from apps.commissioning.models import Harvest, Purchase
from apps.commissioning.tests.factories import (
    HarvestFactory,
    PurchaseFactory,
    ShareArticleFactory,
    StorageFactory,
)

YEAR = 2026
READ_ONLY_WEEK = 39
GRACE_WEEK = 40

URL_ADD_ADDITIONAL = reverse("documentation_summary-add-additional-theoretical-amount")


@pytest.fixture(autouse=True)
def _monday_of_week_41():
    with time_machine.travel(datetime.datetime(2026, 10, 5, 12, 0), tick=False):
        yield


def _assert_refused(resp) -> None:
    assert resp.status_code == status.HTTP_409_CONFLICT, resp.data
    assert resp.data["code"] == "commissioning.past_week"


def _harvest_payload(article, storage, week: int) -> dict:
    return {
        "year": YEAR,
        "delivery_week": week,
        "day_number": 1,
        "share_article": str(article.id),
        "unit": "KG",
        "size": "M",
        "amount": "5",
        "storage": str(storage.id),
    }


def _purchase_payload(article, storage, week: int) -> dict:
    return {
        "year": YEAR,
        "delivery_week": week,
        "share_article": str(article.id),
        "unit": "KG",
        "size": "M",
        "amount": "5",
        "storage": str(storage.id),
    }


@pytest.mark.django_db
class TestHarvestPastWeek:
    URL = reverse("harvest-list")

    def test_create_in_a_read_only_week_is_refused(self, api_client, tenant):
        storage = StorageFactory(is_short_term_harvest_storage=True)
        payload = _harvest_payload(ShareArticleFactory(), storage, READ_ONLY_WEEK)

        _assert_refused(api_client.post(self.URL, payload, format="json"))
        assert not Harvest.objects.filter(delivery_week=READ_ONLY_WEEK).exists()

    def test_create_in_the_grace_week_is_accepted(self, api_client, tenant):
        storage = StorageFactory(is_short_term_harvest_storage=True)
        payload = _harvest_payload(ShareArticleFactory(), storage, GRACE_WEEK)

        resp = api_client.post(self.URL, payload, format="json")

        assert resp.status_code == status.HTTP_201_CREATED, resp.data

    def test_update_of_a_read_only_week_row_is_refused(self, api_client, tenant):
        harvest = HarvestFactory(year=YEAR, delivery_week=READ_ONLY_WEEK, amount=3)
        url = reverse("harvest-detail", kwargs={"pk": harvest.pk})

        _assert_refused(api_client.patch(url, {"amount": "7"}, format="json"))
        harvest.refresh_from_db()
        assert harvest.amount == 3

    def test_moving_a_row_into_a_read_only_week_is_refused(self, api_client, tenant):
        harvest = HarvestFactory(year=YEAR, delivery_week=GRACE_WEEK, amount=3)
        url = reverse("harvest-detail", kwargs={"pk": harvest.pk})

        resp = api_client.patch(url, {"delivery_week": READ_ONLY_WEEK}, format="json")

        _assert_refused(resp)

    def test_update_in_the_grace_week_is_accepted(self, api_client, tenant):
        harvest = HarvestFactory(year=YEAR, delivery_week=GRACE_WEEK, amount=3)
        url = reverse("harvest-detail", kwargs={"pk": harvest.pk})

        resp = api_client.patch(url, {"amount": "7"}, format="json")

        assert resp.status_code == status.HTTP_200_OK, resp.data

    def test_delete_of_a_read_only_week_row_is_refused(self, api_client, tenant):
        harvest = HarvestFactory(year=YEAR, delivery_week=READ_ONLY_WEEK)
        url = reverse("harvest-detail", kwargs={"pk": harvest.pk})

        _assert_refused(api_client.delete(url))
        assert Harvest.objects.filter(pk=harvest.pk).exists()

    def test_bulk_set_as_expected_in_a_read_only_week_is_refused(
        self, api_client, tenant
    ):
        article = ShareArticleFactory()
        storage = StorageFactory(is_short_term_harvest_storage=True)
        item = {
            "id": str(article.id),
            "year": YEAR,
            "delivery_week": READ_ONLY_WEEK,
            "day_number": 1,
            "theoretical_harvest_amount": "4",
            "theoretical_harvest_unit": "KG",
            "theoretical_harvest_size": "M",
            "storage": str(storage.id),
        }

        resp = api_client.post(
            reverse("harvest-bulk-set-as-expected"),
            {"selectedData": [item]},
            format="json",
        )

        _assert_refused(resp)
        assert not Harvest.objects.filter(share_article=article).exists()


@pytest.mark.django_db
class TestPurchasePastWeek:
    URL = reverse("purchase-list")

    def test_create_in_a_read_only_week_is_refused(self, api_client, tenant):
        storage = StorageFactory(is_short_term_harvest_storage=True)
        article = ShareArticleFactory(is_purchased=True)

        resp = api_client.post(
            self.URL,
            _purchase_payload(article, storage, READ_ONLY_WEEK),
            format="json",
        )

        _assert_refused(resp)
        assert not Purchase.objects.filter(share_article=article).exists()

    def test_create_in_the_grace_week_is_accepted(self, api_client, tenant):
        storage = StorageFactory(is_short_term_harvest_storage=True)
        article = ShareArticleFactory(is_purchased=True)

        resp = api_client.post(
            self.URL, _purchase_payload(article, storage, GRACE_WEEK), format="json"
        )

        assert resp.status_code == status.HTTP_201_CREATED, resp.data

    def test_update_of_a_read_only_week_row_is_refused(self, api_client, tenant):
        purchase = PurchaseFactory(year=YEAR, delivery_week=READ_ONLY_WEEK, amount=3)
        url = reverse("purchase-detail", kwargs={"pk": purchase.pk})

        _assert_refused(api_client.patch(url, {"amount": "7"}, format="json"))
        purchase.refresh_from_db()
        assert purchase.amount == 3

    def test_delete_of_a_read_only_week_row_is_refused(self, api_client, tenant):
        purchase = PurchaseFactory(year=YEAR, delivery_week=READ_ONLY_WEEK)
        url = reverse("purchase-detail", kwargs={"pk": purchase.pk})

        _assert_refused(api_client.delete(url))
        assert Purchase.objects.filter(pk=purchase.pk).exists()

    def test_bulk_set_as_expected_in_a_read_only_week_is_refused(
        self, api_client, tenant
    ):
        article = ShareArticleFactory(is_purchased=True)
        storage = StorageFactory(is_short_term_harvest_storage=True)
        item = {
            "id": str(article.id),
            "year": YEAR,
            "delivery_week": READ_ONLY_WEEK,
            "theoretical_purchase_amount": "4",
            "theoretical_purchase_unit": "KG",
            "theoretical_purchase_size": "M",
            "storage": str(storage.id),
        }

        resp = api_client.post(
            reverse("purchase-bulk-set-as-expected"),
            {"selectedData": [item]},
            format="json",
        )

        _assert_refused(resp)
        assert not Purchase.objects.filter(share_article=article).exists()


@pytest.mark.django_db
class TestAdditionalTheoreticalPastWeek:
    def _add(self, api_client, article, week: int):
        StorageFactory(is_short_term_harvest_storage=True)
        return api_client.post(
            URL_ADD_ADDITIONAL,
            {
                "model": "purchase",
                "year": YEAR,
                "delivery_week": week,
                "share_article": str(article.id),
                "unit": "KG",
                "size": "M",
                "amount": "2.00",
            },
            format="json",
        )

    def test_add_in_a_read_only_week_is_refused(self, api_client, tenant):
        article = ShareArticleFactory(is_purchased=True)

        _assert_refused(self._add(api_client, article, READ_ONLY_WEEK))
        assert not Purchase.objects.filter(share_article=article).exists()

    def test_add_in_the_grace_week_is_accepted(self, api_client, tenant):
        resp = self._add(api_client, ShareArticleFactory(is_purchased=True), GRACE_WEEK)

        assert resp.status_code == status.HTTP_201_CREATED, resp.data

    def test_update_of_a_read_only_week_entry_is_refused(self, api_client, tenant):
        purchase = PurchaseFactory(year=YEAR, delivery_week=READ_ONLY_WEEK)
        url = reverse(
            "documentation_summary-update-additional-theoretical-amount",
            kwargs={"pk": purchase.pk},
        )

        resp = api_client.patch(
            url, {"model": "purchase", "amount": "4.00"}, format="json"
        )

        _assert_refused(resp)
