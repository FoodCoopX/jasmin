"""A recompute re-derives the actual corrections of the dimensions it rebuilt
before it allocates the new content movements: the allocation reads those
corrections from the ledger while the cascade is still deferred, so a
correction left at ``counted − Σ_old`` would misplace the new movements. So
does an update of a default share content, for the contents it deleted, and it
cascades the snapshots of the whole rebuild once, at the end.

The recorders wrap the real functions and note the order of the steps.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from unittest.mock import patch

import pytest
import time_machine

from apps.commissioning.models import MovementShareArticle
from apps.commissioning.services import theoretical_objects
from apps.commissioning.services.default_share_content_service import (
    DefaultShareContentService,
)
from apps.commissioning.services.order_content_service import OrderContentService
from apps.commissioning.services.recompute import recompute_shares
from apps.commissioning.services.share_content_service import ShareContentService
from apps.commissioning.services.snapshot_service import SnapshotService
from apps.commissioning.tests.factories import OrderContentFactory
from apps.commissioning.tests.tests_services.test_delete_paths_recompute import (
    _build_harvest_share_content,
)

REDERIVE = "re-derive the old dimensions"
ALLOCATE = "allocate"
CASCADE = "cascade"


def _recording_recalc(events: list[str], old_pks: set[str]):
    real = theoretical_objects.recalculate_actual_corrections

    def recalc(reference_movements, *args, **kwargs):
        if any(movement.pk in old_pks for movement in reference_movements):
            events.append(REDERIVE)
        return real(reference_movements, *args, **kwargs)

    return recalc


@pytest.mark.django_db
class TestRecomputeReDerivesCorrectionsBeforeAllocating:
    def test_share_contents(self, tenant):
        _article, _forecast, share_content = _build_harvest_share_content()
        old_pks = set(
            MovementShareArticle.objects.for_share_contents(
                [share_content]
            ).values_list("pk", flat=True)
        )
        assert old_pks
        events: list[str] = []
        real_create = ShareContentService.create_movements

        def create(self, *args, **kwargs):
            events.append(ALLOCATE)
            return real_create(self, *args, **kwargs)

        with patch.object(
            theoretical_objects,
            "recalculate_actual_corrections",
            _recording_recalc(events, old_pks),
        ), patch.object(ShareContentService, "create_movements", create):
            recompute_shares([share_content.share_id])

        assert events.index(REDERIVE) < events.index(ALLOCATE)

    def test_order_contents(self, tenant):
        order_content = OrderContentFactory()
        OrderContentService().recompute_for_order_contents([order_content])
        old_pks = set(
            MovementShareArticle.objects.for_order_contents(
                [order_content]
            ).values_list("pk", flat=True)
        )
        assert old_pks
        events: list[str] = []
        real_create = OrderContentService.create_movements

        def create(*args, **kwargs):
            events.append(ALLOCATE)
            return real_create(*args, **kwargs)

        with patch.object(
            theoretical_objects,
            "recalculate_actual_corrections",
            _recording_recalc(events, old_pks),
        ), patch.object(OrderContentService, "create_movements", staticmethod(create)):
            OrderContentService().recompute_for_order_contents([order_content])

        assert events.index(REDERIVE) < events.index(ALLOCATE)

    def test_default_share_content_update(self, tenant):
        # Monday of week 15, so the update still replaces the harvest content
        # there, and fills week 16, which had none.
        with time_machine.travel(datetime(2026, 4, 6, 12, 0), tick=False):
            article, _forecast, share_content = _build_harvest_share_content()
            deleted = MovementShareArticle.objects.for_share_contents([share_content])
            assert deleted.filter(is_theoretical=True).exists()
            variation = share_content.share.share_type_variation
            events: list[str] = []
            real_create = ShareContentService.create_movements

            def create(self, *args, **kwargs):
                events.append(ALLOCATE)
                return real_create(self, *args, **kwargs)

            real_cascade = SnapshotService.cascade_for_movements

            def cascade(movements):
                events.append(CASCADE)
                return real_cascade(movements)

            with patch.object(
                theoretical_objects,
                "recalculate_actual_corrections",
                _recording_recalc(events, set(deleted.values_list("pk", flat=True))),
            ), patch.object(
                ShareContentService, "create_movements", create
            ), patch.object(
                SnapshotService, "cascade_for_movements", staticmethod(cascade)
            ):
                DefaultShareContentService.update_default_share_content(
                    year=2026,
                    share_article_id=str(article.pk),
                    validated_data={
                        "year": 2026,
                        "share_article": str(article.pk),
                        "share_option": "HARVEST_SHARE",
                        "range_1": 15,
                        "range_2": 16,
                        "unit": "KG",
                        "size": "M",
                        f"amount_{variation.pk}": Decimal("2"),
                    },
                )

            assert ALLOCATE in events
            assert events.index(REDERIVE) < events.index(ALLOCATE)
            assert events.count(CASCADE) == 1
            assert events[-1] == CASCADE
