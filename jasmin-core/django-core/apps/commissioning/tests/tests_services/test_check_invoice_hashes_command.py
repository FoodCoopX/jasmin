"""``check_invoice_hashes``: checks one tenant's finalized invoices against their
sealed hashes on demand. It exits 0 when every hash still matches, and 1 when
one doesn't, with one ``invoice.hash_drift`` line per invoice in the security
log — the line an auditor greps for.
"""

from __future__ import annotations

import logging
from io import StringIO

import pytest
from django.core.management import call_command

from apps.commissioning.services.invoice_service import InvoiceService
from apps.commissioning.tests.factories import JasminUserFactory
from apps.commissioning.tests.tests_services.test_invoice_service import (
    _corrupt_document_hash,
    _finalized_delivery_note,
)

TAMPERED_HASH = "deadbeef" * 8


def _finalized_invoice(tenant):
    invoice = InvoiceService.create_from_delivery_note(_finalized_delivery_note(tenant))
    InvoiceService.finalize_invoice(invoice, user=JasminUserFactory())
    invoice.refresh_from_db()
    return invoice


@pytest.fixture
def drift_log_lines(caplog):
    """The ``invoice.hash_drift`` lines written to the security log.

    ``django.security`` doesn't propagate to the root logger caplog listens on,
    so its handler is attached to that logger directly.
    """
    security_logger = logging.getLogger("django.security")
    security_logger.addHandler(caplog.handler)
    yield lambda: [
        record.getMessage()
        for record in caplog.records
        if record.getMessage().startswith("invoice.hash_drift")
    ]
    security_logger.removeHandler(caplog.handler)


@pytest.mark.django_db
class TestCheckInvoiceHashes:
    def test_intact_invoices_pass(self, tenant, drift_log_lines):
        _finalized_invoice(tenant)
        out = StringIO()

        call_command("check_invoice_hashes", stdout=out)

        assert "every finalized invoice hash is intact" in out.getvalue()
        assert drift_log_lines() == []

    def test_a_tampered_invoice_exits_1_and_is_logged(self, tenant, drift_log_lines):
        invoice = _finalized_invoice(tenant)
        genuine_hash = invoice.document_hash
        _corrupt_document_hash(invoice, TAMPERED_HASH)
        out = StringIO()

        with pytest.raises(SystemExit) as exit_info:
            call_command("check_invoice_hashes", stdout=out)

        assert exit_info.value.code == 1
        assert (
            f"DRIFT: invoice {invoice.prefix}-{invoice.number} (id={invoice.id})"
            in out.getvalue()
        )
        assert drift_log_lines() == [
            f"invoice.hash_drift id={invoice.id} number={invoice.number} "
            f"prefix={invoice.prefix} stored_hash={TAMPERED_HASH} "
            f"recomputed_hash={genuine_hash}"
        ]
