"""The ISO-week filters build lexicographic comparisons on (year, week); pure
Q construction, no DB. The behaviour on rows is covered where they filter:
the share-weights report across New Year, the stranded-children guards, the
logs window."""

from __future__ import annotations

import datetime as dt

from django.db.models import Q

from apps.shared.iso_week_filters import (
    iso_week_bound,
    iso_week_window,
    iso_week_window_for_dates,
)


class TestIsoWeekWindow:
    def test_within_one_year(self):
        assert iso_week_window((2026, 15), (2026, 16)) == Q(
            year=2026, delivery_week__gte=15, delivery_week__lte=16
        )

    def test_across_years_takes_the_first_years_tail_and_the_last_years_head(
        self,
    ):
        assert iso_week_window((2024, 50), (2026, 2), prefix="share__") == (
            Q(share__year=2024, share__delivery_week__gte=50)
            | Q(share__year__gt=2024, share__year__lt=2026)
            | Q(share__year=2026, share__delivery_week__lte=2)
        )

    def test_selects_nothing_for_a_reversed_range(self):
        assert iso_week_window((2026, 2), (2025, 50)) == Q(pk__in=[])

    def test_names_the_week_column(self):
        assert iso_week_window((2026, 15), (2026, 16), week_field="week") == Q(
            year=2026, week__gte=15, week__lte=16
        )


class TestIsoWeekWindowForDates:
    def test_takes_the_iso_weeks_of_the_dates(self):
        # Wednesday 24 December 2025 lies in 2025's week 52, Sunday 11 January
        # 2026 in 2026's week 2.
        assert iso_week_window_for_dates(
            dt.date(2025, 12, 24), dt.date(2026, 1, 11)
        ) == iso_week_window((2025, 52), (2026, 2))


class TestIsoWeekBound:
    def test_after_a_week(self):
        assert iso_week_bound((2026, 52), "gt", prefix="share__") == Q(
            share__year__gt=2026
        ) | Q(share__year=2026, share__delivery_week__gt=52)

    def test_from_a_week_on(self):
        assert iso_week_bound((2026, 10), "gte", week_field="week") == Q(
            year__gt=2026
        ) | Q(year=2026, week__gte=10)

    def test_before_a_week(self):
        assert iso_week_bound((2026, 1), "lt") == Q(year__lt=2026) | Q(
            year=2026, delivery_week__lt=1
        )

    def test_up_to_a_week(self):
        assert iso_week_bound((2026, 1), "lte") == Q(year__lt=2026) | Q(
            year=2026, delivery_week__lte=1
        )
