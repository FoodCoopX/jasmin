"""The invoice hash check and the import batch pruning, as plain functions.

Jasmin's own Huey tasks (``apps.commissioning.tasks``) call them on jasmin's
schedule. They need no Huey, so a host application that embeds jasmin without
it can call them from its own scheduler. Each takes no arguments, walks every
tenant itself and returns what it did. The subscription renewals, capacity
reservations and waiting-list offers keep their bodies in ``tasks``: they work
on jasmin's own members and subscriptions, which an embedding host keeps
itself.
"""

from __future__ import annotations

import datetime
import logging

from django.utils import timezone

from apps.shared.ops_alerts import alert_operator
from apps.shared.retention import IMPORT_BATCH_RETENTION_DAYS
from apps.shared.tenants.sweep import for_each_tenant

from .invoice_hash import find_drifted_invoices

log = logging.getLogger("django.security")
ops_log = logging.getLogger("tasks")


def check_all_invoice_hashes() -> list[str]:
    """Tamper detection for finalized invoices, nightly, in every tenant.

    The command ``check_invoice_hashes`` checks one tenant on demand. For each
    tenant schema, recomputes the document_hash on every finalized invoice and
    warns on any drift (``invoice.hash_drift``), then emails the operator one
    list of the drifted invoices. Returns that list.
    """
    drifted: list[str] = []

    def check(tenant):
        for inv in find_drifted_invoices():
            log.warning(
                "invoice.hash_drift tenant=%s invoice_id=%s prefix=%s number=%s",
                tenant.schema_name,
                inv["id"],
                inv["prefix"],
                inv["number"],
            )
            drifted.append(
                f"{tenant.schema_name}: invoice {inv['prefix']}{inv['number']}"
                f" (id {inv['id']})"
            )

    # Per-tenant isolation: one bad tenant must NOT abort the sweep. Failures
    # are logged (to the security log) and skipped.
    # ``include_inactive=True``: a frozen (is_active=False) tenant is exactly
    # when tamper detection matters most (offboarding dispute, non-payment,
    # suspected breach). Deactivation is soft (schema kept), the request path is
    # already blocked by TenantActiveMiddleware, and this scan is read-only — so
    # keep watching finalized-invoice hash drift on frozen schemas too.
    for_each_tenant(
        check, label="invoice.hash_check", logger=log, include_inactive=True
    )
    if drifted:
        alert_operator(
            "Finalized invoices changed after finalization",
            "The nightly check found finalized invoices whose stored hash no "
            "longer matches their content, which can mean tampering:\n\n"
            + "\n".join(drifted),
        )
    return drifted


def prune_stale_import_batches() -> int:
    """Prune abandoned ``ShareImportBatch`` rows, weekly.

    Upload + preview cycles leave behind rows in ``FAILED`` or
    ``PREVIEW_READY`` status. Delete those older than
    ``IMPORT_BATCH_RETENTION_DAYS``. Rows in status ``APPLIED`` are NEVER
    deleted — those are the audit trail of what membership changes actually
    happened and when. Returns the number of rows deleted across all tenants.

    Per-tenant: ``ShareImportBatch`` lives in the tenant schema.
    """
    # Lazy import: model lives in a TENANT_APP.
    from apps.commissioning.models.imports import ShareImportBatch

    cutoff = timezone.now() - datetime.timedelta(days=IMPORT_BATCH_RETENTION_DAYS)
    deletable_statuses = (
        ShareImportBatch.STATUS_FAILED,
        ShareImportBatch.STATUS_PREVIEW_READY,
    )
    counters = {"deleted": 0}

    def prune(tenant):
        deleted, _ = ShareImportBatch.objects.filter(
            created_at__lt=cutoff,
            status__in=deletable_statuses,
        ).delete()
        counters["deleted"] += deleted
        if deleted:
            ops_log.info(
                "housekeeping.import_batch_pruned tenant=%s deleted=%s",
                tenant.schema_name,
                deleted,
            )

    for_each_tenant(prune, label="housekeeping.import_batch_pruned")

    ops_log.info(
        "housekeeping.import_batch_pruned total_deleted=%s retention_days=%s",
        counters["deleted"],
        IMPORT_BATCH_RETENTION_DAYS,
    )
    return counters["deleted"]
