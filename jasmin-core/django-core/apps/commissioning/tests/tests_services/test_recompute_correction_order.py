"""A recompute re-derives the actual corrections of the dimensions it rebuilt
before it allocates the new content movements: the allocation reads those
corrections from the ledger while the cascade is still deferred, so a
correction left at ``counted − Σ_old`` would misplace the new movements.

The recorders wrap the real functions and note the order of the two steps.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from apps.commissioning.models import MovementShareArticle
from apps.commissioning.services import theoretical_objects
from apps.commissioning.services.order_content_service import OrderContentService
from apps.commissioning.services.recompute import recompute_shares
from apps.commissioning.services.share_content_service import ShareContentService
from apps.commissioning.tests.factories import OrderContentFactory
from apps.commissioning.tests.tests_services.test_delete_paths_recompute import (
    _build_harvest_share_content,
)

REDERIVE = "re-derive the old dimensions"
ALLOCATE = "allocate"


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
