"""Audit-log entries for writes that bypass ``Model.save()``.

django-auditlog records a registered model's changes from its save signals,
which ``QuerySet.update()`` never sends. :func:`update_and_log` runs the update
and writes the UPDATE entries auditlog would have written for a save.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from auditlog.diff import model_instance_diff
from auditlog.models import LogEntry
from django.conf import settings
from django.db.models import Model


def update_and_log(rows: Sequence[Model], **values: Any) -> int:
    """``update(**values)`` on ``rows``, plus an audit-log UPDATE entry for each
    row it changed; the number of rows updated.

    ``rows`` are the instances as they were before the update, read under the
    caller's lock where it takes one. Each entry diffs one against the row read
    back afterwards, so a value the database computes (``Least(…)``, ``F(…)``)
    is logged as stored, and the model's masked fields stay masked. The actor
    comes from auditlog's request context, as for a save.
    """
    if not rows:
        return 0
    model = type(rows[0])
    pks = [row.pk for row in rows]
    updated = model._base_manager.filter(pk__in=pks).update(**values)
    after_by_pk = model._base_manager.in_bulk(pks)
    use_json = getattr(settings, "AUDITLOG_STORE_JSON_CHANGES", False)
    for before in rows:
        after = after_by_pk.get(before.pk)
        if after is None:
            continue
        changes = model_instance_diff(
            before,
            after,
            fields_to_check=list(values),
            use_json_for_changes=use_json,
        )
        if changes:
            LogEntry.objects.log_create(
                after, action=LogEntry.Action.UPDATE, changes=changes
            )
    return updated
