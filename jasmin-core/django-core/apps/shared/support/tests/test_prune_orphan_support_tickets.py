"""``prune_orphan_support_tickets``: support tickets live in the public schema
with no foreign key to their tenant, so a torn-down tenant leaves its tickets
behind. The command — and the nightly task, which runs the same service —
deletes them and their messages.
"""

from __future__ import annotations

from io import StringIO
from unittest import mock

import pytest
from django.core.management import call_command
from django_tenants.utils import schema_context

from apps.shared.support.models import AuthorKind, SupportTicket, SupportTicketMessage
from apps.shared.tenants.models import Tenant


def _ticket(tenant_schema: str) -> SupportTicket:
    # Every ticket starts with a message: its description.
    with schema_context("public"):
        ticket = SupportTicket.objects.create(
            tenant_schema=tenant_schema, subject="Printer", creator_id="C1"
        )
        for body in ("It jams.", "Still jams."):
            SupportTicketMessage.objects.create(
                ticket=ticket, author_kind=AuthorKind.STAFF, body=body
            )
    return ticket


def _run() -> str:
    out = StringIO()
    call_command("prune_orphan_support_tickets", stdout=out)
    return out.getvalue()


@pytest.mark.django_db
class TestPruneOrphanSupportTickets:
    def test_deletes_a_gone_tenants_tickets_and_keeps_the_rest(self, tenant):
        kept = _ticket(tenant.schema_name)
        orphan = _ticket("torn_down_tenant")

        output = _run()

        with schema_context("public"):
            assert SupportTicket.objects.filter(pk=kept.pk).exists()
            assert not SupportTicket.objects.filter(pk=orphan.pk).exists()
            assert not SupportTicketMessage.objects.filter(ticket_id=orphan.pk).exists()
        # The count is of tickets; their messages go with them uncounted.
        assert "Deleted 1 orphan ticket(s)." in output

    def test_no_tenants_found_deletes_nothing(self, tenant):
        ticket = _ticket(tenant.schema_name)

        with mock.patch.object(Tenant.objects, "values_list", return_value=[]):
            output = _run()

        with schema_context("public"):
            assert SupportTicket.objects.filter(pk=ticket.pk).exists()
        assert "Deleted 0 orphan ticket(s)." in output
