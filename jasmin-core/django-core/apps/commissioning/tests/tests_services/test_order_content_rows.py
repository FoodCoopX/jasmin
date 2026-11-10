"""The Orders page's row for an offer no order has taken yet."""

from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
import time_machine

from apps.commissioning.services.order_content_rows import serialize_unused_offer
from apps.commissioning.tests.factories import (
    OfferFactory,
    ShareArticleNetPriceFactory,
)


@pytest.mark.django_db
class TestUnusedOfferRow:
    @time_machine.travel(datetime.datetime(2026, 11, 4, 12, 0), tick=False)
    def test_carries_the_vat_rate_of_the_offers_week(self, tenant):
        rate_now = ShareArticleNetPriceFactory(tax_rate=Decimal("7.00"))
        ShareArticleNetPriceFactory(
            share_article=rate_now.share_article,
            tax_rate=Decimal("10.00"),
            valid_from=datetime.date(2027, 1, 4),
        )
        offer = OfferFactory(
            year=2027, delivery_week=2, share_article=rate_now.share_article
        )

        assert serialize_unused_offer(offer)["tax_rate"] == Decimal("10.00")
