"""Deleting an offer, finalized or not, while nobody can have acted on it.

An offer goes while no order, delivery-note or invoice line points at it and,
once finalized, while its offer group's week hasn't gone out by email. A
finalized offer is turned back into a draft on the way, the one change its
finalization protection lets through. The list tells the offers page which
offers may go.

No test here depends on the wall clock: the offer endpoint has no past-week
guard.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from django.urls import reverse
from rest_framework import status

from apps.commissioning.errors import OfferAlreadyOrdered
from apps.commissioning.models import InvoiceResellerContent, Offer, OfferSending
from apps.commissioning.services.offer_deletion import offer_deletion_blocker
from apps.commissioning.tests.factories import (
    DeliveryNoteContentFactory,
    InvoiceResellerFactory,
    OfferFactory,
    OfferGroupFactory,
    OrderContentFactory,
    ResellerFactory,
    ShareArticleFactory,
)


def _detail_url(offer_id: str) -> str:
    return reverse("offer-detail", kwargs={"pk": offer_id})


def _send_week(offer: Offer, reseller) -> None:
    """The offer group's week went out by email to ``reseller``."""
    OfferSending.objects.create(
        offer_group=offer.offer_group,
        year=offer.year,
        delivery_week=offer.delivery_week,
        reseller=reseller,
    )


def _order_line(offer: Offer) -> None:
    OrderContentFactory(offer=offer, share_article=None)


def _delivery_note_line(offer: Offer) -> None:
    DeliveryNoteContentFactory(offer=offer, share_article=None)


def _invoice_line(offer: Offer) -> None:
    InvoiceResellerContent.objects.create(
        invoice=InvoiceResellerFactory(),
        offer=offer,
        amount=Decimal("1.000"),
        unit="KG",
        size="M",
        tax_rate=Decimal("7.00"),
    )


def _assert_refused(resp, code: str, offer: Offer, *, finalized: bool) -> None:
    assert resp.status_code == status.HTTP_409_CONFLICT, resp.data
    assert resp.json()["code"] == code
    offer.refresh_from_db()
    assert offer.is_finalized is finalized


@pytest.mark.django_db
class TestDeletingAnOffer:
    def test_a_draft_goes(self, tenant, api_client):
        offer = OfferFactory()

        resp = api_client.delete(_detail_url(offer.pk))

        assert resp.status_code == status.HTTP_204_NO_CONTENT
        assert not Offer.objects.filter(pk=offer.pk).exists()

    def test_a_finalized_offer_nobody_ordered_or_got_by_email_goes(
        self, tenant, api_client
    ):
        offer = OfferFactory(is_finalized=True)

        resp = api_client.delete(_detail_url(offer.pk))

        assert resp.status_code == status.HTTP_204_NO_CONTENT
        assert not Offer.objects.filter(pk=offer.pk).exists()

    @pytest.mark.parametrize("finalized", [True, False])
    @pytest.mark.parametrize(
        "add_line", [_order_line, _delivery_note_line, _invoice_line]
    )
    def test_an_offer_ordered_from_stays(self, tenant, api_client, finalized, add_line):
        # The line would be deleted with the offer.
        offer = OfferFactory(is_finalized=finalized)
        add_line(offer)

        resp = api_client.delete(_detail_url(offer.pk))

        _assert_refused(resp, "offer.already_ordered", offer, finalized=finalized)

    def test_a_finalized_offer_whose_week_went_out_stays(self, tenant, api_client):
        offer = OfferFactory(is_finalized=True)
        _send_week(offer, ResellerFactory())

        resp = api_client.delete(_detail_url(offer.pk))

        _assert_refused(resp, "offer.already_sent", offer, finalized=True)

    def test_a_draft_in_a_week_that_went_out_goes(self, tenant, api_client):
        # A draft isn't in front of a reseller to order from.
        offer = OfferFactory()
        _send_week(offer, ResellerFactory())

        resp = api_client.delete(_detail_url(offer.pk))

        assert resp.status_code == status.HTTP_204_NO_CONTENT

    def test_an_offer_for_one_reseller_stays_once_its_week_went_to_another(
        self, tenant, api_client
    ):
        # Every reseller of the group sees it on the order page.
        offer = OfferFactory(is_finalized=True, reseller=ResellerFactory())
        _send_week(offer, ResellerFactory())

        resp = api_client.delete(_detail_url(offer.pk))

        _assert_refused(resp, "offer.already_sent", offer, finalized=True)


@pytest.mark.django_db
class TestTheListSaysWhichOffersCanGo:
    def test_each_offer_carries_whether_it_can_be_deleted(self, tenant, api_client):
        free = OfferFactory(is_finalized=True)
        ordered = OfferFactory(is_finalized=True, offer_group=free.offer_group)
        OrderContentFactory(offer=ordered, share_article=None)

        resp = api_client.get(
            reverse("offer-list"),
            {
                "year": free.year,
                "delivery_week": free.delivery_week,
                "offer_group": free.offer_group_id,
            },
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        flags = {row["id"]: row["can_be_deleted"] for row in resp.json()}
        assert flags == {free.pk: True, ordered.pk: False}

    def test_a_finalized_offer_in_a_week_that_went_out_cannot(self, tenant, api_client):
        offer = OfferFactory(is_finalized=True)
        _send_week(offer, ResellerFactory())

        resp = api_client.get(
            reverse("offer-list"),
            {
                "year": offer.year,
                "delivery_week": offer.delivery_week,
                "offer_group": offer.offer_group_id,
            },
        )

        [row] = resp.json()
        assert row["can_be_deleted"] is False

    def test_a_new_offer_can(self, tenant, api_client):
        resp = api_client.post(
            reverse("offer-list"),
            {
                "year": 2026,
                "delivery_week": 15,
                "share_article": str(ShareArticleFactory().id),
                "unit": "KG",
                "size": "M",
                "amount_per_pu": "1.000",
                "amount": "40.000",
                "offer_group": str(OfferGroupFactory().id),
            },
            format="json",
        )

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        assert resp.data["can_be_deleted"] is True


@pytest.mark.django_db
class TestTheBlockerOnAnOfferLoadedWithoutTheFlags:
    def test_it_reads_them_from_the_database(self, tenant):
        offer = OfferFactory()
        _order_line(offer)

        assert offer_deletion_blocker(Offer.objects.get(pk=offer.pk)) is (
            OfferAlreadyOrdered
        )
