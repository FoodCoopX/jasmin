"""Day-field defaulting / self-healing on Share.

A Share with a NULL day field gets no theoretical harvest, wash or clean
amount for it, or packs on the delivery day (``Share.DAY_FIELD_DEFAULTS``).
``save()`` defaults them from the ``delivery_day``, but
``bulk_create`` and ``get_or_create`` on a *reused* row both bypass ``save()``
— so the model exposes explicit healers. These tests pin that behaviour down
through the REAL entry points.
"""

from __future__ import annotations

import pytest

from apps.commissioning.models import Share
from apps.commissioning.tests.factories import (
    SharesDeliveryDayFactory,
    ShareTypeVariationFactory,
)

# The factory seeds these defaults on the delivery day — healers must copy them.
EXPECTED = {
    "harvesting_day": 1,
    "packing_day": 2,
    "washing_day": 1,
    "cleaning_day": 1,
    "get_current_stock_day": 0,
}


def _null_day_share(delivery_day, variation, *, week: int = 15) -> Share:
    """Create a Share with NULL day fields by going through ``bulk_create``
    (which bypasses ``Share.save()``)."""
    Share.objects.bulk_create(
        [
            Share(
                year=2026,
                delivery_week=week,
                delivery_day=delivery_day,
                share_type_variation=variation,
            )
        ]
    )
    return Share.objects.get(year=2026, delivery_week=week, delivery_day=delivery_day)


@pytest.mark.django_db
class TestShareDayFieldDefaulting:
    def test_save_defaults_day_fields(self, tenant):
        """The plain ``save()`` path fills every day field from the day."""
        dd = SharesDeliveryDayFactory()
        variation = ShareTypeVariationFactory()
        share = Share.objects.create(
            year=2026, delivery_week=15, delivery_day=dd, share_type_variation=variation
        )
        for field, value in EXPECTED.items():
            assert getattr(share, field) == value

    def test_bulk_create_leaves_null_days(self, tenant):
        """bulk_create skips save() → NULL days."""
        dd = SharesDeliveryDayFactory()
        share = _null_day_share(dd, ShareTypeVariationFactory())
        for field in EXPECTED:
            assert getattr(share, field) is None

    def test_ensure_day_fields_heals_and_persists(self, tenant):
        dd = SharesDeliveryDayFactory()
        share = _null_day_share(dd, ShareTypeVariationFactory())

        changed = share.ensure_day_fields()

        assert changed is True
        for field, value in EXPECTED.items():
            assert getattr(share, field) == value
        # Persisted, not just in memory.
        share.refresh_from_db()
        for field, value in EXPECTED.items():
            assert getattr(share, field) == value

    def test_ensure_day_fields_is_noop_when_already_set(self, tenant):
        dd = SharesDeliveryDayFactory()
        variation = ShareTypeVariationFactory()
        share = Share.objects.create(
            year=2026, delivery_week=15, delivery_day=dd, share_type_variation=variation
        )
        assert share.ensure_day_fields() is False

    def test_get_or_create_for_delivery_creates_with_days(self, tenant):
        dd = SharesDeliveryDayFactory()
        variation = ShareTypeVariationFactory()
        share, created = Share.get_or_create_for_delivery(
            year=2026, delivery_week=15, delivery_day=dd, share_type_variation=variation
        )
        assert created is True
        for field, value in EXPECTED.items():
            assert getattr(share, field) == value

    def test_get_or_create_for_delivery_heals_reused_null_share(self, tenant):
        """A NULL-day share exists (from a bulk_create),
        a later get_or_create reuses it — and must heal it, not pass it
        through untouched."""
        dd = SharesDeliveryDayFactory()
        variation = ShareTypeVariationFactory()
        stale = _null_day_share(dd, variation)

        share, created = Share.get_or_create_for_delivery(
            year=2026, delivery_week=15, delivery_day=dd, share_type_variation=variation
        )

        assert created is False
        assert share.pk == stale.pk
        share.refresh_from_db()
        for field, value in EXPECTED.items():
            assert getattr(share, field) == value

    def test_heal_day_fields_bulk(self, tenant):
        dd = SharesDeliveryDayFactory()
        stale = [
            _null_day_share(dd, ShareTypeVariationFactory(), week=w)
            for w in (15, 16, 17)
        ]
        # Re-fetch with the delivery_day available (heal reads its defaults).
        loaded = list(
            Share.objects.filter(pk__in=[s.pk for s in stale]).select_related(
                "delivery_day"
            )
        )

        healed = Share.heal_day_fields(loaded)

        assert healed == 3
        for share in Share.objects.filter(pk__in=[s.pk for s in stale]):
            for field, value in EXPECTED.items():
                assert getattr(share, field) == value

    def test_heal_day_fields_skips_already_set(self, tenant):
        dd = SharesDeliveryDayFactory()
        variation = ShareTypeVariationFactory()
        good = Share.objects.create(
            year=2026, delivery_week=15, delivery_day=dd, share_type_variation=variation
        )
        assert Share.heal_day_fields([good]) == 0


@pytest.mark.django_db
class TestReusedSharesHeal:
    """Every path that reuses an existing Share heals its day fields, as
    ``Share.get_or_create_for_delivery`` does."""

    def test_a_delivery_moved_to_another_weekday_heals_that_days_share(self, tenant):
        from apps.commissioning.viewsets.shares_viewsets import ShareDeliveryViewSet

        variation = ShareTypeVariationFactory()
        wednesday = SharesDeliveryDayFactory(day_number=2)
        friday = SharesDeliveryDayFactory(day_number=4)
        source = Share.objects.create(
            year=2026,
            delivery_week=15,
            delivery_day=wednesday,
            share_type_variation=variation,
        )
        stale = _null_day_share(friday, variation)

        target = ShareDeliveryViewSet._share_for_delivery_day(source, friday)

        assert target.pk == stale.pk
        target.refresh_from_db()
        for field, value in EXPECTED.items():
            assert getattr(target, field) == value

    def test_a_subscriptions_shares_heal_a_reused_share(self, tenant):
        import datetime

        import time_machine

        from apps.commissioning.services.subscription_service import (
            SubscriptionService,
        )
        from apps.commissioning.tests.factories import SubscriptionFactory

        with time_machine.travel(datetime.datetime(2026, 1, 5, 12, 0), tick=False):
            subscription = SubscriptionFactory()
            service = SubscriptionService()
            (_year, week), *_ = service._delivery_weeks_excluding_paused(subscription)
            stale = _null_day_share(
                subscription.default_delivery_station_day.delivery_day,
                subscription.share_type_variation,
                week=week,
            )

            service._create_shares(subscription)

        stale.refresh_from_db()
        for field, value in EXPECTED.items():
            assert getattr(stale, field) == value

    def test_a_forecasts_lookup_heals_a_reused_share(self, tenant):
        from apps.commissioning.services.forecast_service import ForecastService
        from apps.commissioning.tests.factories import ShareArticleFactory

        variation = ShareTypeVariationFactory()
        stale = _null_day_share(SharesDeliveryDayFactory(), variation)

        *_, existing_shares, _contents = (
            ForecastService._prefetch_share_content_context(
                share_article=ShareArticleFactory(),
                size=None,
                year=2026,
                unit=None,
                delivery_week=15,
                variation_ids=[variation.pk],
            )
        )

        assert stale.pk in {share.pk for share in existing_shares.values()}
        stale.refresh_from_db()
        for field, value in EXPECTED.items():
            assert getattr(stale, field) == value
