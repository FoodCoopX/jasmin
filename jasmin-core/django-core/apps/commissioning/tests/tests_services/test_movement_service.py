"""Tests for movements — calculate_current_stock_for_allocation & create_movements."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from unittest.mock import patch

import pytest
import time_machine
from django.utils.timezone import make_aware

from apps.commissioning.models import (
    CurrentStockBalance,
    MovementShareArticle,
    StockSnapshot,
)
from apps.commissioning.services.movements import (
    MovementSourceData,
    calculate_current_stock_for_allocation,
    create_movements,
)
from apps.commissioning.services.snapshot_service import SnapshotService
from apps.commissioning.tests.factories import (
    MovementShareArticleFactory,
    ShareArticleFactory,
    ShareContentFactory,
    StorageFactory,
)


# ---------------------------------------------------------------------------
# MovementSourceData
# ---------------------------------------------------------------------------
class TestMovementSourceData:
    def test_source_kwargs_share_content(self):
        sentinel = object()
        src = MovementSourceData(
            year=2026,
            delivery_week=15,
            delivery_day=2,
            packing_day=1,
            share_article=None,
            unit="KG",
            size="M",
            amount=Decimal("10"),
            movement_type="SHARE",
            share_content=sentinel,
        )
        assert src.source_kwargs == {"share_content": sentinel}

    def test_source_kwargs_order_content(self):
        sentinel = object()
        src = MovementSourceData(
            year=2026,
            delivery_week=15,
            delivery_day=2,
            packing_day=1,
            share_article=None,
            unit="KG",
            size="M",
            amount=Decimal("10"),
            movement_type="ORDER",
            order_content=sentinel,
        )
        assert src.source_kwargs == {"order_content": sentinel}


# ---------------------------------------------------------------------------
# calculate_current_stock_for_allocation
# ---------------------------------------------------------------------------
@pytest.mark.django_db
class TestCalculateCurrentStockForAllocation:
    def test_returns_sorted_stocks(self, tenant):
        article = ShareArticleFactory()
        s1 = StorageFactory(is_short_term_harvest_storage=True)
        s2 = StorageFactory()

        # Simulate StockService returning two storages with stock
        mock_stock_map = {
            (str(article.pk), "KG", "M", str(s1.pk)): {
                "current_stock_amount": Decimal("20"),
                "theoretical_current_stock": Decimal("20"),
                "is_finalized": False,
            },
            (str(article.pk), "KG", "M", str(s2.pk)): {
                "current_stock_amount": Decimal("5"),
                "theoretical_current_stock": Decimal("5"),
                "is_finalized": False,
            },
        }

        with patch(
            "apps.commissioning.services.stock_service.StockService.get_current_stock_without_projection",
            return_value=mock_stock_map,
        ):
            stocks = calculate_current_stock_for_allocation(
                article,
                "KG",
                "M",
                2026,
                15,
                1,
            )

        # Smallest first
        assert len(stocks) == 2
        assert stocks[0]["amount"] == Decimal("5")
        assert stocks[1]["amount"] == Decimal("20")

    def test_excludes_zero_stock(self, tenant):
        article = ShareArticleFactory()
        s1 = StorageFactory()

        mock_stock_map = {
            (str(article.pk), "KG", "M", str(s1.pk)): {
                "current_stock_amount": Decimal("0"),
                "theoretical_current_stock": Decimal("0"),
                "is_finalized": False,
            },
        }

        with patch(
            "apps.commissioning.services.stock_service.StockService.get_current_stock_without_projection",
            return_value=mock_stock_map,
        ):
            stocks = calculate_current_stock_for_allocation(
                article,
                "KG",
                "M",
                2026,
                15,
                1,
            )

        assert stocks == []


# ---------------------------------------------------------------------------
# create_movements
# ---------------------------------------------------------------------------
@pytest.mark.django_db
class TestCreateMovements:
    def _make_source(self, article, share_content, **overrides):
        defaults = dict(
            year=2026,
            delivery_week=15,
            delivery_day=2,
            packing_day=1,
            share_article=article,
            unit="KG",
            size="M",
            amount=Decimal("10"),
            movement_type="SHARE",
            share_content=share_content,
        )
        defaults.update(overrides)
        return MovementSourceData(**defaults)

    def test_negative_movement_when_no_stock(self, tenant):
        short = StorageFactory(is_short_term_harvest_storage=True)
        article = ShareArticleFactory()
        sc = ShareContentFactory(share_article=article)

        with patch(
            "apps.commissioning.services.movements.calculate_current_stock_for_allocation",
            return_value=[],
        ), patch(
            "apps.commissioning.services.snapshot_service.SnapshotService.cascade_for_movements",
        ):
            movements = create_movements([self._make_source(article, sc)])

        assert len(movements) == 1
        assert movements[0].amount == Decimal("-10")
        assert movements[0].storage == short

    def test_allocates_across_storages(self, tenant):
        s1 = StorageFactory(is_short_term_harvest_storage=True)
        s2 = StorageFactory()
        article = ShareArticleFactory()
        sc = ShareContentFactory(share_article=article)

        stocks = [
            {"storage_id": s1.pk, "amount": Decimal("3"), "is_finalized": False},
            {"storage_id": s2.pk, "amount": Decimal("20"), "is_finalized": False},
        ]

        with patch(
            "apps.commissioning.services.movements.calculate_current_stock_for_allocation",
            return_value=stocks,
        ), patch(
            "apps.commissioning.services.snapshot_service.SnapshotService.cascade_for_movements",
        ):
            movements = create_movements(
                [self._make_source(article, sc, amount=Decimal("8"))]
            )

        assert len(movements) == 2
        amounts = sorted(m.amount for m in movements)
        assert amounts == [Decimal("-5"), Decimal("-3")]

    def test_records_remainder_when_stock_under_covers_demand(self, tenant):
        """When available stock (3) is LESS than demand (10), the loop deducts
        what's there and the uncovered remainder (7) is recorded against
        short-term storage — total recorded outflow == the full demand (-10).
        Silently dropping the uncovered amount would leave
        theoretical_current_stock too high."""
        short = StorageFactory(is_short_term_harvest_storage=True)
        s2 = StorageFactory()
        article = ShareArticleFactory()
        sc = ShareContentFactory(share_article=article)

        stocks = [
            {"storage_id": s2.pk, "amount": Decimal("3"), "is_finalized": False},
        ]

        with patch(
            "apps.commissioning.services.movements.calculate_current_stock_for_allocation",
            return_value=stocks,
        ), patch(
            "apps.commissioning.services.snapshot_service.SnapshotService.cascade_for_movements",
        ):
            movements = create_movements(
                [self._make_source(article, sc, amount=Decimal("10"))]
            )

        assert len(movements) == 2
        # Total outflow equals the full demand, not just the covered 3.
        assert sum(m.amount for m in movements) == Decimal("-10")
        # The uncovered 7 lands on short-term storage.
        remainder = [m for m in movements if m.storage == short]
        assert len(remainder) == 1
        assert remainder[0].amount == Decimal("-7")

    def _totals_by_storage(self, movements):
        totals: dict = {}
        for m in movements:
            totals[m.storage_id] = totals.get(m.storage_id, Decimal("0")) + m.amount
        return totals

    def test_sibling_sources_share_per_storage_stock(self, tenant):
        """Two sources for the same (article, unit, size) in
        the SAME snapshot draw from ONE shared per-storage pool. Storage X holds
        10; two demands of 6 → X depletes to 0 (−10 total, drawn once) and the
        uncovered 2 spills to short-term (−2). Allocating each sibling against
        the full 10 would give −6/−6 on X (a phantom −2 parked there)."""
        short = StorageFactory(is_short_term_harvest_storage=True)
        x = StorageFactory()
        article = ShareArticleFactory()
        sc = ShareContentFactory(share_article=article)

        stocks = [{"storage_id": x.pk, "amount": Decimal("10"), "is_finalized": False}]

        with patch(
            "apps.commissioning.services.movements.calculate_current_stock_for_allocation",
            return_value=stocks,
        ), patch(
            "apps.commissioning.services.snapshot_service.SnapshotService.cascade_for_movements",
        ):
            movements = create_movements(
                [
                    self._make_source(article, sc, amount=Decimal("6")),
                    self._make_source(article, sc, amount=Decimal("6")),
                ]
            )

        totals = self._totals_by_storage(movements)
        assert totals[x.pk] == Decimal("-10")  # storage X drawn ONCE, to empty
        assert totals[short.pk] == Decimal("-2")  # uncovered remainder spills
        assert sum(m.amount for m in movements) == Decimal("-12")  # full demand

    def test_sources_in_different_snapshots_do_not_share_stock(self, tenant):
        """Scoping guard: the shared counter is keyed by snapshot, so two sources
        for the same article in DIFFERENT snapshots (here different packing days)
        each draw against their OWN per-storage pool — no cross-snapshot
        depletion, no spurious short-term spill."""
        short = StorageFactory(is_short_term_harvest_storage=True)
        x = StorageFactory()
        article = ShareArticleFactory()
        sc = ShareContentFactory(share_article=article)

        stocks = [{"storage_id": x.pk, "amount": Decimal("10"), "is_finalized": False}]

        with patch(
            "apps.commissioning.services.movements.calculate_current_stock_for_allocation",
            return_value=stocks,
        ), patch(
            "apps.commissioning.services.snapshot_service.SnapshotService.cascade_for_movements",
        ):
            movements = create_movements(
                [
                    self._make_source(article, sc, amount=Decimal("6"), packing_day=1),
                    self._make_source(article, sc, amount=Decimal("6"), packing_day=2),
                ]
            )

        totals = self._totals_by_storage(movements)
        # Each source independently takes 6 from X; nothing spills to short-term.
        assert totals[x.pk] == Decimal("-12")
        assert short.pk not in totals

    def test_returns_empty_for_no_sources(self, tenant):
        result = create_movements([])
        assert result == []


# ---------------------------------------------------------------------------
# ShareContent movement-capture helper — single source of truth for the
# "both movement halves" filter used by the delete/replace paths.
# ---------------------------------------------------------------------------
@pytest.mark.django_db
class TestCreateMovementsOnThePackingDay:
    """On today's packing day the allocation reads the snapshots and the
    movements after them, not the ``CurrentStockBalance`` projection: a
    recompute deletes the old movements and defers the cascade, so the
    projection still counts them, and a count's correction delta still answers
    the old balance, while the new ones are allocated."""

    # Tuesday of ISO week 15, 2026: the packing day of that week's Wednesday
    # delivery.
    PACKING_DAY = datetime(2026, 4, 7, 12, 0)

    def test_splits_across_the_storages_by_the_ledger_while_the_projection_lags(
        self, tenant
    ):
        with time_machine.travel(self.PACKING_DAY, tick=False):
            small = StorageFactory(is_short_term_harvest_storage=True)
            large = StorageFactory()
            article = ShareArticleFactory()
            share_content = ShareContentFactory(share_article=article)
            # Monday's count: 5 kg in the small storage, 20 kg in the large one.
            day_before = make_aware(datetime(2026, 4, 6, 12, 0))
            counted = [
                MovementShareArticleFactory(
                    share_article=article,
                    storage=storage,
                    amount=amount,
                    counted_amount=amount,
                    movement_type="INVENTORY",
                    date=day_before,
                )
                for storage, amount in ((small, Decimal("5")), (large, Decimal("20")))
            ]
            # An earlier allocation took the small storage's 5 kg, and the
            # projection counts it.
            earlier = MovementShareArticleFactory(
                share_article=article,
                storage=small,
                amount=Decimal("-5"),
                date=make_aware(self.PACKING_DAY),
                movement_type="SHARECONTENT",
                share_content=share_content,
            )
            SnapshotService.cascade_for_movements([*counted, earlier])
            # The recompute deletes it and defers the cascade.
            MovementShareArticle.objects.filter(pk=earlier.pk).delete()
            assert CurrentStockBalance.objects.get(
                share_article=article, storage=small
            ).balance == Decimal("0")

            movements = create_movements(
                [
                    MovementSourceData(
                        year=2026,
                        delivery_week=15,
                        delivery_day=2,
                        packing_day=1,
                        share_article=article,
                        unit="KG",
                        size="M",
                        amount=Decimal("8"),
                        movement_type="SHARECONTENT",
                        share_content=share_content,
                    )
                ],
                collect_movements=[],
            )

        # Smallest first, from what the ledger holds: the small storage's 5 kg,
        # then 3 from the large one.
        assert sorted((m.storage_id, m.amount) for m in movements) == sorted(
            [(small.pk, Decimal("-5")), (large.pk, Decimal("-3"))]
        )

    def test_a_recompute_keeps_the_split_around_a_count_on_the_packing_day(
        self, tenant
    ):
        with time_machine.travel(self.PACKING_DAY, tick=False):
            small = StorageFactory(is_short_term_harvest_storage=True)
            large = StorageFactory()
            article = ShareArticleFactory()
            share_content = ShareContentFactory(share_article=article)
            # Counted 20 in the large storage on Monday, 5 in the small one
            # on the packing day's evening.
            counts = [
                MovementShareArticleFactory(
                    share_article=article,
                    storage=storage,
                    amount=amount,
                    counted_amount=amount,
                    movement_type="INVENTORY",
                    date=make_aware(at),
                )
                for storage, amount, at in (
                    (large, Decimal("20"), datetime(2026, 4, 6, 12, 0)),
                    (small, Decimal("5"), datetime(2026, 4, 7, 23, 0)),
                )
            ]
            SnapshotService.cascade_for_movements(counts)

            def allocate(**kwargs):
                return create_movements(
                    [
                        MovementSourceData(
                            year=2026,
                            delivery_week=15,
                            delivery_day=2,
                            packing_day=1,
                            share_article=article,
                            unit="KG",
                            size="M",
                            amount=Decimal("8"),
                            movement_type="SHARECONTENT",
                            share_content=share_content,
                        )
                    ],
                    **kwargs,
                )

            # The first plan cascades, which moves the evening count's delta:
            # 5 kg counted after 5 kg left that day is a correction of +10.
            first = allocate()
            counts[1].refresh_from_db()
            assert counts[1].amount == Decimal("10")
            # The recompute deletes those movements and defers the cascade.
            MovementShareArticle.objects.filter(
                pk__in=[movement.pk for movement in first]
            ).delete()
            again = allocate(collect_movements=[])

        split = sorted((m.storage_id, m.amount) for m in first)
        assert split == sorted([(small.pk, Decimal("-5")), (large.pk, Decimal("-3"))])
        assert sorted((m.storage_id, m.amount) for m in again) == split

    def test_a_count_entered_after_the_plan_holds_without_a_snapshot(self, tenant):
        with time_machine.travel(self.PACKING_DAY, tick=False):
            small = StorageFactory(is_short_term_harvest_storage=True)
            large = StorageFactory()
            article = ShareArticleFactory()
            share_content = ShareContentFactory(share_article=article)
            monday = make_aware(datetime(2026, 4, 6, 12, 0))
            counts = [
                MovementShareArticleFactory(
                    share_article=article,
                    storage=storage,
                    amount=amount,
                    counted_amount=amount,
                    movement_type="INVENTORY",
                    date=monday,
                )
                for storage, amount in ((small, Decimal("10")), (large, Decimal("20")))
            ]
            SnapshotService.cascade_for_movements(counts)

            def allocate(**kwargs):
                return create_movements(
                    [
                        MovementSourceData(
                            year=2026,
                            delivery_week=15,
                            delivery_day=2,
                            packing_day=1,
                            share_article=article,
                            unit="KG",
                            size="M",
                            amount=Decimal("8"),
                            movement_type="SHARECONTENT",
                            share_content=share_content,
                        )
                    ],
                    **kwargs,
                )

            # The plan takes all 8 kg from the small storage (10 kg).
            planned = allocate()
            assert [(m.storage_id, m.amount) for m in planned] == [
                (small.pk, Decimal("-8"))
            ]
            # That evening the office counts 2 kg there, through the entry
            # path: a delta against the current balance (2 − 2 = 0), then the
            # day's rebuild, whose cascade drops the snapshot it made.
            evening = make_aware(datetime(2026, 4, 7, 23, 0))
            MovementShareArticleFactory(
                share_article=article,
                storage=small,
                amount=Decimal("0"),
                counted_amount=Decimal("2"),
                movement_type="INVENTORY",
                date=evening,
            )
            SnapshotService.rebuild_entity_day(
                str(article.pk),
                "KG",
                "M",
                str(small.pk),
                day_start=make_aware(datetime(2026, 4, 7, 0, 0)),
                day_end=make_aware(datetime(2026, 4, 7, 23, 59, 59)),
                snapshot_date=evening,
            )
            assert not StockSnapshot.objects.filter(
                storage=small, snapshot_date=evening
            ).exists()

            # Two recomputes in a row, each deleting the last allocation.
            splits = []
            last = planned
            for _ in range(2):
                MovementShareArticle.objects.filter(
                    pk__in=[movement.pk for movement in last]
                ).delete()
                deferred: list[MovementShareArticle] = []
                last = allocate(collect_movements=deferred)
                SnapshotService.cascade_for_movements(deferred)
                splits.append(sorted((m.storage_id, m.amount) for m in last))

        # The count's 2 kg first, then 6 from the large storage, both times.
        expected = sorted([(small.pk, Decimal("-2")), (large.pk, Decimal("-6"))])
        assert splits == [expected, expected]


def _q_lookup_paths(node) -> set[str]:
    """Flatten a Q tree to the set of lookup paths (left-hand sides) it uses."""
    paths: set[str] = set()
    for child in node.children:
        if hasattr(child, "children"):
            paths |= _q_lookup_paths(child)
        else:
            paths.add(child[0])
    return paths


class TestShareContentMovementCapture:
    def test_theoretical_fk_tuple_matches_source_map(self):
        """Drift guard: the capture tuple must cover exactly the ShareContent-
        reachable ``theoretical_*`` source FKs — NOT the ``additional_theoretical_*``
        ones (no ``share_content`` FK). Adding a new theoretical type to
        ``_SOURCE_TO_TYPE`` fails this until the capture tuple is updated too."""
        from apps.commissioning.models.movements import (
            _SHARE_CONTENT_THEORETICAL_FKS,
            _SOURCE_TO_TYPE,
        )

        expected = {
            key
            for key in _SOURCE_TO_TYPE
            if key.startswith("theoretical_")
            and not key.startswith("additional_theoretical_")
        }
        assert set(_SHARE_CONTENT_THEORETICAL_FKS) == expected

    def test_queryset_branch_covers_share_content_and_all_theoretical_halves(self):
        from apps.commissioning.models.movements import (
            _SHARE_CONTENT_THEORETICAL_FKS,
            share_content_movement_q,
        )

        paths = _q_lookup_paths(share_content_movement_q(["sc-1", "sc-2"]))
        assert "share_content__in" in paths
        for fk in _SHARE_CONTENT_THEORETICAL_FKS:
            assert f"{fk}__share_content__in" in paths

    def test_instance_branch_uses_exact_lookup(self):
        from apps.commissioning.models import ShareContent
        from apps.commissioning.models.movements import share_content_movement_q

        # Unsaved instance — no DB needed; only the isinstance(Model) branch.
        paths = _q_lookup_paths(share_content_movement_q(ShareContent()))
        assert "share_content" in paths
        assert "share_content__in" not in paths
        assert "theoretical_harvest__share_content" in paths
