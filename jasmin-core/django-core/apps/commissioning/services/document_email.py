"""Bulk send of finalized invoices and delivery notes to their resellers — the
Huey job behind the "send by email" action of the Invoices and Delivery notes
pages. Kept out of the view layer so the task calls it without the HTTP layer.
"""

from __future__ import annotations

import logging
from typing import Any

from django.db import DatabaseError

from .bulk_email_job import emit_progress

logger = logging.getLogger(__name__)


def bulk_send_documents(
    *,
    order_ids: list[str],
    model: str,
    progress_cb=None,
) -> dict[str, Any]:
    """Email each order's invoice or delivery note (``model``) to the
    reseller's invoice address, through the same send as the per-document
    action — so each attempt leaves an EmailLog row and the document is
    stamped as sent only when the mail went out.

    A document already sent is skipped and counted as sent: a re-run after a
    partial failure sends only the rest (the per-document action re-sends on
    purpose). A document that can't be sent — none yet, not finalized, no
    PDF, no address, invoices on paper only — is reported for its order.

    Returns ``{total_processed, successful, failed, results, errors}``, the
    shape the other bulk-email jobs return; ``progress_cb`` receives a
    snapshot after each order.
    """
    from ..models import Order
    from . import DeliveryNoteService, InvoiceService
    from .bulk_results import format_order_error

    orders = list(
        Order.objects.filter(id__in=order_ids).select_related(
            "delivery_note", "reseller"
        )
    )
    found = {str(order.id) for order in orders}
    errors: list[dict[str, Any]] = [
        {
            "order_id": str(order_id),
            "order_number": None,
            "error": "Order not found",
            "success": False,
        }
        for order_id in order_ids
        if str(order_id) not in found
    ]
    results: list[dict[str, Any]] = []
    invoice_by_delivery_note = (
        InvoiceService.get_invoices_for_delivery_notes(
            [
                delivery_note.id
                for order in orders
                if (delivery_note := getattr(order, "delivery_note", None)) is not None
            ]
        )
        if model == "invoice"
        else {}
    )
    send = (
        InvoiceService.send_to_reseller
        if model == "invoice"
        else DeliveryNoteService.send_to_reseller
    )

    successful = 0
    for processed, order in enumerate(orders, start=1):
        try:
            document, reason = _sendable_document(
                order, model, invoice_by_delivery_note
            )
            if document is None:
                errors.append(format_order_error(order, reason))
            elif document.has_been_sent_to_reseller_at is not None:
                results.append(_result(order, document, already_sent=True))
                successful += 1
            elif send(document):
                results.append(_result(order, document))
                successful += 1
            else:
                errors.append(
                    format_order_error(
                        order, "The email could not be sent — see the email log."
                    )
                )
        except (DatabaseError, ValueError, TypeError, AttributeError) as exc:
            logger.exception(
                "documents.bulk_send.failed order=%s model=%s", order.pk, model
            )
            errors.append(format_order_error(order, str(exc)))
        emit_progress(
            progress_cb,
            processed=processed,
            successful=successful,
            failed=processed - successful,
            total=len(orders),
        )

    return {
        "total_processed": len(order_ids),
        "successful": successful,
        "failed": len(errors),
        "results": results,
        "errors": errors,
    }


def _sendable_document(
    order, model: str, invoice_by_delivery_note: dict[str, Any]
) -> tuple[Any, str]:
    """``(document, "")`` when ``order``'s invoice or delivery note can be
    emailed, else ``(None, why)`` — the preconditions of the per-document
    send action."""
    delivery_note = getattr(order, "delivery_note", None)
    if delivery_note is None:
        return None, "No delivery note found for this order"
    document = (
        invoice_by_delivery_note.get(delivery_note.id)
        if model == "invoice"
        else delivery_note
    )
    if document is None:
        return None, "No invoice found for this delivery note"
    label = "Invoice" if model == "invoice" else "Delivery note"
    if not document.is_finalized:
        return None, f"{label} is not finalized"
    if not document.file:
        return None, "PDF not yet uploaded"
    reseller = order.reseller
    if not reseller.invoice_email:
        return None, "No email address found for reseller"
    if model == "invoice" and not reseller.invoice_via_email:
        return None, "Reseller takes invoices on paper only"
    return document, ""


def _result(order, document, *, already_sent: bool = False) -> dict[str, Any]:
    row: dict[str, Any] = {
        "order_id": str(order.id),
        "order_number": order.full_number,
        "document_number": document.full_number,
        "success": True,
    }
    if already_sent:
        row["already_sent"] = True
    return row
