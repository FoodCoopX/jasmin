"""Member auditlog masking — PII must not land in change diffs.

``Member`` is auditlog-registered with ``mask_fields`` so the raw IBAN,
email, address etc. never reach ``auditlog_logentry.changes`` (which is
retained forever): each of their values is stored as ``AUDIT_LOG_MASK``.
``birth_date`` is the statutory GenG date-of-birth — PII_IMMEDIATE for erasure
and special-category-adjacent — so it must be in the mask list too, or every
Member create/edit writes the plaintext DoB into the audit table. This test
pins it masked.
"""

from __future__ import annotations

import datetime

import pytest
from auditlog.models import LogEntry

from apps.commissioning.tests.factories import JasminUserFactory, MemberFactory
from apps.shared.pii_masking import AUDIT_LOG_MASK


def _latest_update(member) -> LogEntry:
    entries = LogEntry.objects.get_for_object(member)
    assert entries.exists(), (
        "Member saves should produce auditlog entries — is the "
        "auditlog registration in commissioning/apps.py gone?"
    )
    return entries.filter(action=LogEntry.Action.UPDATE).latest("timestamp")


@pytest.mark.django_db
class TestMemberAuditlogMasking:
    def test_birth_date_is_masked_in_change_diffs(self, tenant):
        """The old and the new DoB are both stored as the mask. The field is
        still audited — its key appears in the diff — just never readable."""
        user = JasminUserFactory()
        member = MemberFactory(user=user, birth_date=datetime.date(1985, 3, 14))
        member.birth_date = datetime.date(1990, 7, 2)
        member.save()

        update = _latest_update(member)
        assert update.changes["birth_date"] == [AUDIT_LOG_MASK, AUDIT_LOG_MASK]

    def test_iban_is_masked_in_full(self, tenant):
        """Nothing of the IBAN is kept, not even the second half auditlog's own
        default mask would."""
        user = JasminUserFactory()
        member = MemberFactory(user=user, iban="DE89370400440532013000")
        member.iban = "AT611904300234573201"
        member.save()

        update = _latest_update(member)
        assert update.changes["iban"] == [AUDIT_LOG_MASK, AUDIT_LOG_MASK]
