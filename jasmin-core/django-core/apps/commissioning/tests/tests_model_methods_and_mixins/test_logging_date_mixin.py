"""Tests for DateDocumentMixin and ArchivableMixin."""

from __future__ import annotations

import datetime

import pytest
import time_machine
from django.utils import timezone

from apps.commissioning.errors import DocumentDateRequired
from apps.commissioning.models import Forecast, ShareContent
from apps.commissioning.models.managers import archive_cutoff_week
from apps.commissioning.tests.factories import (
    DeliveryNoteResellerFactory,
    ForecastFactory,
    ShareContentFactory,
    ShareFactory,
)


# ---------------------------------------------------------------------------
# DateDocumentMixin   (DeliveryNoteReseller / InvoiceReseller)
#
# Saving without a ``date`` raises ``DocumentDateRequired`` — silently
# auto-setting ``date = today`` would be a GoBD audit hazard for legal
# documents. The factory provides a stable default so tests don't need to
# be threaded with ``date=``.
# ---------------------------------------------------------------------------
@pytest.mark.django_db
class TestDateDocumentMixin:
    def test_raises_when_date_is_none(self, tenant):
        with pytest.raises(DocumentDateRequired):
            DeliveryNoteResellerFactory(date=None)

    def test_preserves_explicit_date(self, tenant):
        explicit = datetime.date(2025, 1, 1)
        dn = DeliveryNoteResellerFactory(date=explicit)
        assert dn.date == explicit

    @time_machine.travel("2026-04-15")
    def test_does_not_overwrite_on_update(self, tenant):
        explicit = datetime.date(2025, 6, 15)
        dn = DeliveryNoteResellerFactory(date=explicit)
        dn.save()  # second save should NOT overwrite
        dn.refresh_from_db()
        assert dn.date == explicit


# ---------------------------------------------------------------------------
# ArchivableMixin   (``active`` and its cutoff week)
# A record is archived by the delivery week it is for, not by when it was
# written: share contents and forecasts are planned months ahead.
# Concrete models: ShareContent (its share's week), Forecast (its own week).
# ---------------------------------------------------------------------------
def _share_like(share, year, delivery_week):
    """Another week's share of the same variation and delivery day."""
    return ShareFactory(
        year=year,
        delivery_week=delivery_week,
        share_type_variation=share.share_type_variation,
        delivery_day=share.delivery_day,
    )


@pytest.mark.django_db
class TestArchivableMixin:
    @pytest.fixture(autouse=True)
    def _frozen_clock(self):
        # Monday 15 June 2026, ISO week 25; two months back is Thursday
        # 16 April, ISO week 16.
        with time_machine.travel(datetime.datetime(2026, 6, 15, 12, 0), tick=False):
            yield

    def test_the_cutoff_is_the_week_the_months_lead_back_to(self, tenant):
        assert archive_cutoff_week() == (2026, 16)
        assert archive_cutoff_week(6) == (2025, 51)

    def test_content_planned_months_ahead_stays_current_in_its_week(self, tenant):
        content = ShareContentFactory(
            share=ShareFactory(year=2026, delivery_week=25),
            created_at=timezone.now() - datetime.timedelta(days=200),
        )

        assert ShareContent.active.filter(pk=content.pk).exists()

    def test_content_of_a_week_before_the_cutoff_is_archived(self, tenant):
        kept = ShareContentFactory(share=ShareFactory(year=2026, delivery_week=16))
        archived = ShareContentFactory(share=_share_like(kept.share, 2026, 15))

        assert ShareContent.active.filter(pk=kept.pk).exists()
        assert not ShareContent.active.filter(pk=archived.pk).exists()
        assert (
            ShareContent.active.for_period(is_past=True).filter(pk=archived.pk).exists()
        )

    def test_a_later_year_is_current_and_an_earlier_one_archived(self, tenant):
        next_year = ShareContentFactory(share=ShareFactory(year=2027, delivery_week=1))
        last_year = ShareContentFactory(share=_share_like(next_year.share, 2025, 52))

        assert ShareContent.active.filter(pk=next_year.pk).exists()
        assert not ShareContent.active.filter(pk=last_year.pk).exists()

    def test_week_53_counts_as_a_week_of_its_iso_year(self, tenant):
        kept = ShareContentFactory(share=ShareFactory(year=2026, delivery_week=53))
        archived = ShareContentFactory(share=_share_like(kept.share, 2026, 52))

        # 60 days before 1 March 2027 is Thursday 31 December 2026, ISO week
        # 53 of 2026.
        with time_machine.travel(datetime.datetime(2027, 3, 1, 12, 0), tick=False):
            assert archive_cutoff_week() == (2026, 53)
            assert ShareContent.active.filter(pk=kept.pk).exists()
            assert not ShareContent.active.filter(pk=archived.pk).exists()

    def test_a_forecast_is_archived_by_its_own_week(self, tenant):
        planned_early = ForecastFactory(
            year=2026,
            delivery_week=30,
            created_at=timezone.now() - datetime.timedelta(days=200),
        )
        old_week = ForecastFactory(year=2026, delivery_week=10)

        assert Forecast.active.filter(pk=planned_early.pk).exists()
        assert not Forecast.active.filter(pk=old_week.pk).exists()
