"""The nightly invoice hash check emails the operator the drifted invoices."""

from __future__ import annotations

from unittest import mock

import pytest

from apps.commissioning.services.scheduled_upkeep import check_all_invoice_hashes

FIND_DRIFTED = "apps.commissioning.services.scheduled_upkeep.find_drifted_invoices"


@pytest.mark.django_db
class TestInvoiceHashDriftAlert:
    def test_drifted_invoices_are_emailed_in_one_list(
        self, tenant, mailoutbox, django_capture_on_commit_callbacks
    ):
        drifted = [{"id": "inv-1", "prefix": "RE", "number": 7}]
        with (
            mock.patch(FIND_DRIFTED, return_value=drifted),
            django_capture_on_commit_callbacks(execute=True),
        ):
            check_all_invoice_hashes()

        assert len(mailoutbox) == 1
        assert "invoice RE7 (id inv-1)" in mailoutbox[0].body

    def test_no_drift_sends_nothing(
        self, tenant, mailoutbox, django_capture_on_commit_callbacks
    ):
        with (
            mock.patch(FIND_DRIFTED, return_value=[]),
            django_capture_on_commit_callbacks(execute=True),
        ):
            check_all_invoice_hashes()

        assert mailoutbox == []
