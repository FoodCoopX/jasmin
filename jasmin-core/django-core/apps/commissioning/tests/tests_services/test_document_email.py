"""Tests for ``bulk_send_documents`` — the job behind "send by email" on the
Invoices and Delivery notes pages.

It goes through the per-document send, so a document is stamped as sent only
when the mail went out; a document already sent is skipped, and one that
can't be sent is reported for its order. ``EmailService.send_email`` is
patched with ``autospec=True`` so the mock keeps the instance binding.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from apps.commissioning.models import DeliveryNoteReseller, InvoiceReseller
from apps.commissioning.services import InvoiceService
from apps.commissioning.services.document_email import bulk_send_documents
from apps.commissioning.tests.factories import (
    DeliveryNoteContentFactory,
    JasminUserFactory,
    OrderFactory,
    ResellerFactory,
    ShareArticleFactory,
)
from apps.shared.tenants.email_service import EmailService

pytestmark = pytest.mark.django_db


def _pdf():
    return SimpleUploadedFile(
        "doc.pdf", b"%PDF-1.4 test", content_type="application/pdf"
    )


def _order_with_final_delivery_note(reseller, day_number):
    order = OrderFactory(reseller=reseller, day_number=day_number)
    delivery_note = DeliveryNoteReseller.objects.create(order=order, date=date.today())
    DeliveryNoteContentFactory(
        delivery_note=delivery_note,
        share_article=ShareArticleFactory(),
        amount=Decimal("10.000"),
        unit="KG",
        size="M",
        price_per_unit=Decimal("2.50"),
    )
    delivery_note.finalize(user=JasminUserFactory())
    delivery_note.file = _pdf()
    delivery_note.save(update_fields=["file"])
    return order


def _order_with_final_invoice(reseller, day_number, *, finalized=True, pdf=True):
    order = _order_with_final_delivery_note(reseller, day_number)
    invoice = InvoiceService.create_from_delivery_note(order.delivery_note)
    if finalized:
        InvoiceReseller.objects.filter(pk=invoice.pk).update(is_finalized=True)
        invoice.refresh_from_db()
    if pdf:
        invoice.file = _pdf()
        invoice.save(update_fields=["file"])
    return order, invoice


@pytest.fixture
def reseller():
    return ResellerFactory(invoice_email="orders@example.org", invoice_via_email=True)


@pytest.fixture
def send_email():
    with mock.patch.object(
        EmailService, "send_email", autospec=True, return_value=True
    ) as patched:
        yield patched


class TestBulkSendInvoices:
    def test_sends_and_stamps_each_invoice(self, tenant, reseller, send_email):
        pairs = [_order_with_final_invoice(reseller, day) for day in range(2)]

        result = bulk_send_documents(
            order_ids=[str(order.id) for order, _ in pairs], model="invoice"
        )

        assert result["successful"] == 2
        assert result["errors"] == []
        assert send_email.call_count == 2
        assert send_email.call_args.kwargs["to_emails"] == ["orders@example.org"]
        for _, invoice in pairs:
            invoice.refresh_from_db()
            assert invoice.has_been_sent_to_reseller_at is not None

    def test_an_invoice_already_sent_is_skipped(self, tenant, reseller, send_email):
        order, invoice = _order_with_final_invoice(reseller, 0)
        InvoiceReseller.objects.filter(pk=invoice.pk).update(
            has_been_sent_to_reseller_at=timezone.now()
        )

        result = bulk_send_documents(order_ids=[str(order.id)], model="invoice")

        assert result["successful"] == 1
        assert result["results"][0]["already_sent"] is True
        assert send_email.call_count == 0

    def test_unsendable_invoices_are_reported(self, tenant, reseller, send_email):
        draft, _ = _order_with_final_invoice(reseller, 0, finalized=False)
        no_pdf, _ = _order_with_final_invoice(reseller, 1, pdf=False)
        paper = ResellerFactory(
            invoice_email="paper@example.org", invoice_via_email=False
        )
        paper_only, _ = _order_with_final_invoice(paper, 2)

        result = bulk_send_documents(
            order_ids=[str(o.id) for o in (draft, no_pdf, paper_only)],
            model="invoice",
        )

        assert {error["order_id"]: error["error"] for error in result["errors"]} == {
            str(draft.id): "Invoice is not finalized",
            str(no_pdf.id): "PDF not yet uploaded",
            str(paper_only.id): "Reseller takes invoices on paper only",
        }
        assert result["successful"] == 0
        assert send_email.call_count == 0

    def test_a_failed_send_is_reported_and_not_stamped(self, tenant, reseller):
        order, invoice = _order_with_final_invoice(reseller, 0)

        with mock.patch.object(
            EmailService, "send_email", autospec=True, return_value=False
        ):
            result = bulk_send_documents(order_ids=[str(order.id)], model="invoice")

        assert result["failed"] == 1
        invoice.refresh_from_db()
        assert invoice.has_been_sent_to_reseller_at is None

    def test_an_unknown_order_is_reported(self, tenant, reseller, send_email):
        result = bulk_send_documents(order_ids=["missing00000"], model="invoice")

        assert result["errors"] == [
            {
                "order_id": "missing00000",
                "order_number": None,
                "error": "Order not found",
                "success": False,
            }
        ]


class TestBulkSendDeliveryNotes:
    def test_sends_and_stamps_each_delivery_note(self, tenant, reseller, send_email):
        orders = [_order_with_final_delivery_note(reseller, day) for day in range(2)]

        result = bulk_send_documents(
            order_ids=[str(order.id) for order in orders], model="delivery_note"
        )

        assert result["successful"] == 2
        assert send_email.call_count == 2
        for order in orders:
            order.delivery_note.refresh_from_db()
            assert order.delivery_note.has_been_sent_to_reseller_at is not None

    def test_a_reseller_without_an_address_is_reported(self, tenant, send_email):
        order = _order_with_final_delivery_note(ResellerFactory(invoice_email=""), 0)

        result = bulk_send_documents(order_ids=[str(order.id)], model="delivery_note")

        assert result["errors"][0]["error"] == "No email address found for reseller"
        assert send_email.call_count == 0
