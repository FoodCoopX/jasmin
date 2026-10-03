"""The bulk document endpoints reserve their batch against the weekly caps.

Each reserves one ledger row per document it may finalize up front — the
delivery notes an invoice finalization cascades to included, the documents
already final left out — refusing an over-cap batch before finalizing
anything, and finalizes with ``skip_quota=True``, so a batch larger than the
per-minute burst cap goes through and nothing is counted twice. The rows of
documents that end up unfinalized are refunded, and a document that can't be
finalized (an empty one) fails alone instead of aborting the batch. The caps
here are written to the tenant row, because the request's middleware loads
the tenant from the database.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from django.urls import reverse
from rest_framework import status

from apps.commissioning.models import DeliveryNoteReseller, InvoiceReseller
from apps.commissioning.services import InvoiceService
from apps.commissioning.services.invoice_service import InvoiceLinePricing
from apps.commissioning.tests.factories import (
    DeliveryNoteContentFactory,
    JasminUserFactory,
    OrderContentFactory,
    OrderFactory,
    ResellerFactory,
    ShareArticleFactory,
)
from apps.shared.tenants.models import ActionRateLog, RateLimitedAction, Tenant

pytestmark = pytest.mark.django_db

DN = RateLimitedAction.DELIVERY_NOTE_FINALIZATION
INV = RateLimitedAction.INVOICE_FINALIZATION


def _cap(tenant, action, *, weekly, per_minute):
    Tenant.objects.filter(pk=tenant.pk).update(
        action_rate_limit_overrides={
            str(action): {"weekly": weekly, "per_minute": per_minute}
        }
    )


def _reserved(tenant, action) -> int:
    return ActionRateLog.objects.filter(
        tenant_schema=tenant.schema_name, action=action
    ).count()


def _order_with_draft_delivery_note(reseller, day_number):
    # One order per reseller and delivery slot, so each gets its own day.
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
    return order


def _order_with_empty_delivery_note(reseller, day_number):
    order = OrderFactory(reseller=reseller, day_number=day_number)
    DeliveryNoteReseller.objects.create(order=order, date=date.today())
    return order


def _invoice_on_unfinalized_delivery_note(reseller, day_number):
    """A draft invoice with a line on a delivery note that isn't final, as
    older data can have it; finalizing the invoice finalizes the note too."""
    order = _order_with_draft_delivery_note(reseller, day_number)
    invoice = InvoiceReseller.objects.create(reseller=reseller, date=date.today())
    line = order.delivery_note.items.get()
    InvoiceService._create_invoice_article_content(
        invoice,
        line,
        InvoiceLinePricing(
            amount=line.amount, tax_rate=line.tax_rate, rabatt=0, source_rabatt=None
        ),
        order_content=line.order_content,
        delivery_note_contents=(line,),
    )
    return order, invoice


def _draft_invoice(reseller, day_number):
    order = _order_with_draft_delivery_note(reseller, day_number)
    order.delivery_note.finalize(user=JasminUserFactory())
    return InvoiceService.create_from_delivery_note(order.delivery_note)


def _finalized(model, objects) -> list[bool]:
    return list(
        model.objects.filter(pk__in=[o.pk for o in objects])
        .order_by("pk")
        .values_list("is_finalized", flat=True)
    )


class TestBulkFinalize:
    url = reverse("bulk_finalize")

    def test_a_batch_past_the_burst_cap_reserves_one_row_per_invoice(
        self, api_client, tenant
    ):
        reseller = ResellerFactory()
        invoices = [_draft_invoice(reseller, day) for day in range(3)]
        _cap(tenant, INV, weekly=10, per_minute=1)

        resp = api_client.post(
            self.url,
            {"model": "InvoiceReseller", "ids": [str(i.id) for i in invoices]},
            format="json",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert resp.data["finalized_count"] == 3
        assert _reserved(tenant, INV) == 3

    def test_an_already_finalized_invoice_reserves_nothing(self, api_client, tenant):
        reseller = ResellerFactory()
        drafts = [_draft_invoice(reseller, day) for day in range(2)]
        done = _draft_invoice(reseller, 2)
        InvoiceService.finalize_invoice(done, user=JasminUserFactory())
        before = _reserved(tenant, INV)

        resp = api_client.post(
            self.url,
            {
                "model": "InvoiceReseller",
                "ids": [str(i.id) for i in [*drafts, done]],
            },
            format="json",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert _reserved(tenant, INV) - before == 2

    def test_a_batch_over_the_weekly_cap_finalizes_nothing(self, api_client, tenant):
        reseller = ResellerFactory()
        invoices = [_draft_invoice(reseller, day) for day in range(3)]
        _cap(tenant, INV, weekly=2, per_minute=100)

        resp = api_client.post(
            self.url,
            {"model": "InvoiceReseller", "ids": [str(i.id) for i in invoices]},
            format="json",
        )

        assert resp.status_code == status.HTTP_429_TOO_MANY_REQUESTS
        assert _finalized(InvoiceReseller, invoices) == [False, False, False]
        assert _reserved(tenant, INV) == 0


class TestBulkFinalizeDocuments:
    url = reverse("bulk_finalize_documents")

    def test_a_batch_past_the_burst_cap_reserves_one_row_per_delivery_note(
        self, api_client, tenant
    ):
        reseller = ResellerFactory()
        orders = [_order_with_draft_delivery_note(reseller, day) for day in range(3)]
        _cap(tenant, DN, weekly=10, per_minute=1)

        resp = api_client.post(
            self.url,
            {"ids": [str(o.id) for o in orders], "model": "delivery_note"},
            format="json",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        delivery_notes = [o.delivery_note for o in orders]
        assert _finalized(DeliveryNoteReseller, delivery_notes) == [True] * 3
        assert _reserved(tenant, DN) == 3

    def test_a_batch_over_the_weekly_cap_finalizes_nothing(self, api_client, tenant):
        reseller = ResellerFactory()
        orders = [_order_with_draft_delivery_note(reseller, day) for day in range(3)]
        _cap(tenant, DN, weekly=2, per_minute=100)

        resp = api_client.post(
            self.url,
            {"ids": [str(o.id) for o in orders], "model": "delivery_note"},
            format="json",
        )

        assert resp.status_code == status.HTTP_429_TOO_MANY_REQUESTS
        delivery_notes = [o.delivery_note for o in orders]
        assert _finalized(DeliveryNoteReseller, delivery_notes) == [False] * 3
        assert _reserved(tenant, DN) == 0


class TestBulkCreateDocumentsFromOrders:
    url = reverse("bulk_create_documents_from_orders")

    def test_invoices_reserve_the_delivery_note_finalizations(self, api_client, tenant):
        reseller = ResellerFactory()
        orders = [_order_with_draft_delivery_note(reseller, day) for day in range(3)]
        _cap(tenant, DN, weekly=10, per_minute=1)

        resp = api_client.post(
            self.url,
            {
                "ids": [str(o.id) for o in orders],
                "model": "invoice",
                "date": date.today().isoformat(),
            },
            format="json",
        )

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        assert resp.data["successful"] == 3
        assert _reserved(tenant, DN) == 3

    def test_delivery_notes_are_only_created_and_reserve_nothing(
        self, api_client, tenant
    ):
        reseller = ResellerFactory()
        orders = [OrderFactory(reseller=reseller, day_number=day) for day in range(3)]
        for order in orders:
            OrderContentFactory(order=order)

        resp = api_client.post(
            self.url,
            {
                "ids": [str(o.id) for o in orders],
                "model": "delivery_note",
                "date": date.today().isoformat(),
            },
            format="json",
        )

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        assert _reserved(tenant, DN) == 0


class TestBulkCreateSummaryInvoiceFromOrders:
    url = reverse("bulk_create_summary_invoice_from_orders")

    def test_reserves_the_delivery_note_finalizations(self, api_client, tenant):
        reseller = ResellerFactory()
        orders = [_order_with_draft_delivery_note(reseller, day) for day in range(3)]
        _cap(tenant, DN, weekly=10, per_minute=1)

        resp = api_client.post(
            self.url,
            {"ids": [str(o.id) for o in orders], "date": date.today().isoformat()},
            format="json",
        )

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        assert _reserved(tenant, DN) == 3


class TestOnlyWhatIsFinalizedCounts:
    def test_an_empty_delivery_note_fails_alone_and_is_refunded(
        self, api_client, tenant
    ):
        reseller = ResellerFactory()
        orders = [_order_with_draft_delivery_note(reseller, day) for day in range(2)]
        empty = _order_with_empty_delivery_note(reseller, 2)

        resp = api_client.post(
            reverse("bulk_finalize_documents"),
            {"ids": [str(o.id) for o in [*orders, empty]], "model": "delivery_note"},
            format="json",
        )

        assert resp.status_code == status.HTTP_207_MULTI_STATUS, resp.data
        assert resp.data["successful"] == 2
        assert [error["order_id"] for error in resp.data["errors"]] == [str(empty.id)]
        assert _reserved(tenant, DN) == 2

    def test_finalizing_invoices_reserves_the_delivery_notes_they_cascade_to(
        self, api_client, tenant
    ):
        reseller = ResellerFactory()
        pairs = [
            _invoice_on_unfinalized_delivery_note(reseller, day) for day in range(3)
        ]
        _cap(tenant, DN, weekly=10, per_minute=1)
        assert InvoiceService.unfinalized_upstream_delivery_note_ids(
            [invoice.pk for _, invoice in pairs]
        ) == {str(order.delivery_note.pk) for order, _ in pairs}

        resp = api_client.post(
            reverse("bulk_finalize_documents"),
            {"ids": [str(order.id) for order, _ in pairs], "model": "invoice"},
            format="json",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert _finalized(InvoiceReseller, [i for _, i in pairs]) == [True] * 3
        assert (
            _finalized(DeliveryNoteReseller, [o.delivery_note for o, _ in pairs])
            == [True] * 3
        )
        assert _reserved(tenant, INV) == 3
        assert _reserved(tenant, DN) == 3

    def test_invoices_on_final_delivery_notes_reserve_no_delivery_note(
        self, api_client, tenant
    ):
        reseller = ResellerFactory()
        invoices = [_draft_invoice(reseller, day) for day in range(2)]
        orders = [
            invoice.items.first().delivery_note_contents.first().delivery_note.order
            for invoice in invoices
        ]

        resp = api_client.post(
            reverse("bulk_finalize_documents"),
            {"ids": [str(order.id) for order in orders], "model": "invoice"},
            format="json",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert _reserved(tenant, INV) == 2
        assert _reserved(tenant, DN) == 0

    def test_creating_invoices_from_final_delivery_notes_reserves_nothing(
        self, api_client, tenant
    ):
        reseller = ResellerFactory()
        orders = [_order_with_draft_delivery_note(reseller, day) for day in range(2)]
        for order in orders:
            order.delivery_note.finalize(user=JasminUserFactory())

        resp = api_client.post(
            reverse("bulk_create_documents_from_orders"),
            {
                "ids": [str(o.id) for o in orders],
                "model": "invoice",
                "date": date.today().isoformat(),
            },
            format="json",
        )

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        assert _reserved(tenant, DN) == 0

    def test_a_summary_invoice_reserves_only_the_notes_it_finalizes(
        self, api_client, tenant
    ):
        reseller = ResellerFactory()
        final = _order_with_draft_delivery_note(reseller, 0)
        final.delivery_note.finalize(user=JasminUserFactory())
        draft = _order_with_draft_delivery_note(reseller, 1)
        empty = _order_with_empty_delivery_note(reseller, 2)

        resp = api_client.post(
            reverse("bulk_create_summary_invoice_from_orders"),
            {
                "ids": [str(o.id) for o in [final, draft, empty]],
                "date": date.today().isoformat(),
            },
            format="json",
        )

        assert resp.status_code == status.HTTP_207_MULTI_STATUS, resp.data
        assert resp.data["total_orders_included"] == 2
        assert [error["order_id"] for error in resp.data["errors"]] == [str(empty.id)]
        # Reserved for the draft and the empty note; the empty one is refunded.
        assert _reserved(tenant, DN) == 1

    def test_a_failed_invoice_is_refunded(self, api_client, tenant):
        reseller = ResellerFactory()
        invoices = [_draft_invoice(reseller, day) for day in range(2)]
        empty = InvoiceReseller.objects.create(reseller=reseller, date=date.today())

        resp = api_client.post(
            reverse("bulk_finalize"),
            {
                "model": "InvoiceReseller",
                "ids": [str(i.id) for i in [*invoices, empty]],
            },
            format="json",
        )

        assert resp.status_code == status.HTTP_207_MULTI_STATUS, resp.data
        assert resp.data["finalized_count"] == 2
        assert _reserved(tenant, INV) == 2
