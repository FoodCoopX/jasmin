"""Totals of the planned share contents, and the theoretical harvest objects
and stock movements built from them.

The common base of ``ShareContentService``'s two other parts: the planning
writes rebuild these objects, and the planning page's data shows the totals.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from django.db import transaction

from ..models import (
    MovementShareArticle,
    ShareContent,
    ShareTypeVariation,
    Storage,
)
from ..utils import batch_get_physical_variation_totals_for_weeks


class ShareContentStock:
    """Per-variation totals of planned share contents, and the theoretical
    objects and movements they drive."""

    def variation_totals_by_week(
        self, share_contents: list[ShareContent]
    ) -> dict[tuple[int, int], dict]:
        """Demand totals for every (year, week) covered by ``share_contents``
        — ONE aggregated query per year (in practice: one) instead of 2-3
        per week. Keyed ``{(year, week): {"basic"|"tour"|"station": {...}}}``.

        Uses the union of variations across the year's weeks; a week where
        a variation has no demand simply has no lookup entry, which every
        consumer already treats as 0.
        """
        weeks_by_year: dict[int, set[int]] = defaultdict(set)
        variation_ids_by_year: dict[int, set] = defaultdict(set)
        for share_content in share_contents:
            weeks_by_year[share_content.share.year].add(
                share_content.share.delivery_week
            )
            variation_ids_by_year[share_content.share.year].add(
                share_content.share.share_type_variation_id
            )

        totals: dict[tuple[int, int], dict] = {}
        for year, weeks in weeks_by_year.items():
            physical_variations = list(
                ShareTypeVariation.objects.filter(
                    id__in=variation_ids_by_year[year],
                    variation_type="physical",
                )
            )
            if not physical_variations:
                continue
            week_totals = batch_get_physical_variation_totals_for_weeks(
                physical_variations, year, sorted(weeks)
            )
            for week, lookups in week_totals.items():
                totals[(year, week)] = lookups
        return totals

    @staticmethod
    def _total_quantity_for(
        share_content: ShareContent,
        variation_totals_by_week: dict[tuple[int, int], dict],
    ) -> int:
        """The subscribed-share quantity this content's amount is multiplied by.

        Every content is station-scoped, so it keys into the ``"station"``
        bucket (day, variation, station). This is THE keying contract between
        the theoretical builder and the SHARECONTENT movement builder — both
        MUST resolve the identical quantity for a row or planned harvest and
        packed stock silently diverge, so it lives in exactly one place.
        """
        week_totals = variation_totals_by_week.get(
            (share_content.share.year, share_content.share.delivery_week), {}
        )
        return week_totals.get("station", {}).get(
            (
                share_content.share.delivery_day_id,
                share_content.share.share_type_variation_id,
                share_content.delivery_station_id,
            ),
            0,
        )

    @transaction.atomic
    def create_all_theoretical_objects(
        self,
        share_contents: list[ShareContent],
        variation_totals_by_week: dict[tuple[int, int], dict] | None = None,
        *,
        collect_movements: list[MovementShareArticle] | None = None,
    ) -> dict[str, list]:
        """Create all theoretical objects in a single optimized operation.

        ``variation_totals_by_week``: pass the precomputed result of
        :meth:`variation_totals_by_week` when calling this back-to-back
        with :meth:`create_movements` (as every caller does) — both need
        the identical lookup and computing it twice doubles the most
        expensive queries of the recompute path.

        ``collect_movements`` defers the snapshot cascade to the caller —
        see ``theoretical_objects.create_theoretical_objects``.
        """
        from .theoretical_objects import (
            TheoreticalSourceData,
            build_theoretical_objects_from_rows,
        )

        if variation_totals_by_week is None:
            variation_totals_by_week = self.variation_totals_by_week(share_contents)

        def build_source(share_content, short_term, long_term):
            total_quantity = self._total_quantity_for(
                share_content, variation_totals_by_week
            )

            storage = Storage.select_harvest(
                short_term=short_term,
                long_term=long_term,
                comes_from_long_term=share_content.comes_from_long_term_storage,
            )

            return TheoreticalSourceData(
                year=share_content.share.year,
                delivery_week=share_content.share.delivery_week,
                delivery_day=share_content.share.delivery_day.day_number,
                harvesting_day=share_content.share.harvesting_day,
                washing_day=share_content.share.washing_day,
                cleaning_day=share_content.share.cleaning_day,
                share_article=share_content.share_article,
                amount=share_content.amount,
                unit=share_content.unit,
                size=share_content.size,
                note=share_content.note,
                washing=share_content.washing,
                cleaning=share_content.cleaning,
                forecast=share_content.forecast,
                seller=share_content.seller,
                is_purchased=share_content.share_article.is_purchased,
                share_content=share_content,
                storage=storage,
                total_amount_for_shares=(
                    share_content.amount * total_quantity
                    if share_content.amount
                    else None
                ),
                # A linked Forecast must match the content's size (enforced by
                # ShareContent._validate_forecast_dimensions), so the harvest is
                # planned on the content's OWN size — the same dimension the
                # actual-harvest correction lands on, so the actual offsets the
                # theoretical instead of double-counting on a separate size.
                harvest_size=share_content.size,
                comes_from_long_term_storage=share_content.comes_from_long_term_storage,
            )

        return build_theoretical_objects_from_rows(
            share_contents, build_source, collect_movements=collect_movements
        )

    @transaction.atomic
    def create_movements(
        self,
        share_contents: list[ShareContent],
        variation_totals_by_week: dict[tuple[int, int], dict] | None = None,
        *,
        collect_movements: list[MovementShareArticle] | None = None,
    ) -> list[MovementShareArticle]:
        """Create MovementShareArticle objects with storage allocation.

        ``variation_totals_by_week``: see
        :meth:`create_all_theoretical_objects` — pass the shared
        precomputed lookup when calling both.

        ``collect_movements`` defers the snapshot cascade to the caller —
        see ``movements.create_movements``.
        """
        from .movements import MovementSourceData, create_movements

        sources: list[MovementSourceData] = []

        if variation_totals_by_week is None:
            variation_totals_by_week = self.variation_totals_by_week(share_contents)

        for share_content in share_contents:
            # A cleared forecast row carries amount=None ("no human plan yet" —
            # set by replace_share_planning when every cell is emptied). It
            # contributes no SHARECONTENT movement (nothing to move), and
            # Decimal(str(None)) below would raise InvalidOperation. The
            # theoretical builder keeps a None-total theoretical for the row;
            # movements simply skip it.
            if share_content.amount is None:
                continue

            packing_day = share_content.share.packing_day
            if packing_day is None:
                packing_day = share_content.share.delivery_day.day_number

            total_quantity = self._total_quantity_for(
                share_content, variation_totals_by_week
            )

            total_amount = abs(
                Decimal(str(share_content.amount)) * Decimal(str(total_quantity))
            )

            sources.append(
                MovementSourceData(
                    year=share_content.share.year,
                    delivery_week=share_content.share.delivery_week,
                    delivery_day=share_content.share.delivery_day.day_number,
                    packing_day=packing_day,
                    share_article=share_content.share_article,
                    unit=share_content.unit,
                    size=share_content.size,
                    amount=total_amount,
                    movement_type="SHARECONTENT",
                    share_content=share_content,
                )
            )

        return create_movements(sources, collect_movements=collect_movements)
