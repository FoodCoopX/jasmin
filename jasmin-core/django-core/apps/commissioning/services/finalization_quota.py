"""Finalization quota for the bulk document endpoints.

A bulk finalize reserves its batch against the weekly caps up front, so an
over-cap batch is refused before anything is finalized, and then finalizes
with ``skip_quota=True`` so it doesn't trip the per-minute burst cap halfway.
The reservation covers exactly the documents the batch may finalize — the
delivery notes an invoice finalization cascades to included — and the rows of
those still unfinalized at the end (a failed item, a cascade that never ran)
are refunded, so they don't count against the weekly cap for seven days.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.db.models import QuerySet

from apps.shared.tenants.rate_limits import (
    enforce_action_quota_batch,
    release_action_quota,
)


@dataclass(frozen=True)
class FinalizationReservation:
    """Ledger rows reserved for finalizing ``documents``."""

    rows: list[str]
    documents: QuerySet[Any]

    def release_unused(self) -> None:
        """Refund the rows of the documents still unfinalized. Call it inside
        the request's transaction, after the batch has run."""
        finalized = self.documents.filter(is_finalized=True).count()
        release_action_quota(self.rows[finalized:])


def reserve_finalizations(
    action: str,
    documents: QuerySet[Any],
    *,
    actor: Any,
    count: int | None = None,
) -> FinalizationReservation:
    """Reserve one ``action`` per document of ``documents``, all unfinalized
    now, or ``count`` when some of them are only created during the run.

    ``documents`` must keep naming the same rows afterwards — select them by
    primary key, or by order for the delivery notes a run creates — never by
    ``is_finalized``. Raises the 429 when the batch exceeds the weekly cap.
    """
    rows = enforce_action_quota_batch(
        action,
        count=documents.count() if count is None else count,
        actor=actor,
    )
    return FinalizationReservation(rows=rows, documents=documents)
