"""Tests that ``GDPRService.anonymize_user`` scrubs every PII column
on the ``Member`` row.

The retention-block tests (``test_retention_blocks.py``) and the
extended-anonymization tests (``test_extended_anonymization.py``)
cover the surrounding pipeline. This file owns the
member-scrub-completeness check: one explicit assertion per
PII-bearing field, so any future column added to ``Member`` lands
either in this test (✓ classified) or in the
``test_field_classification_guard`` (✗ unclassified → CI fails).
"""

from __future__ import annotations

import datetime

import pytest
import time_machine
from django.db.models import F

from apps.commissioning.models import CoopShare, CoopShareTransfer, Member
from apps.commissioning.services.member_cancellation import (
    cancel_member_with_coop_shares,
)
from apps.commissioning.tests.factories import (
    CoopShareFactory,
    JasminUserFactory,
    MemberFactory,
)
from apps.gdpr.services import GDPRService
from apps.gdpr.services.subjects import ErasureSubject


@pytest.mark.django_db
class TestMemberAnonymization:
    def test_birth_date_is_scrubbed(self, tenant):
        """DoB is directly-identifying PII — must be NULLed on
        anonymization."""
        user = JasminUserFactory()
        member = MemberFactory(
            user=user,
            birth_date=datetime.date(1985, 3, 14),
        )

        GDPRService.anonymize_user(user)

        member.refresh_from_db()
        assert member.birth_date is None, (
            "birth_date survived anonymisation — check "
            "FIELD_CLASSIFICATION['commissioning.Member']"
        )

    def test_full_identity_block_is_scrubbed(self, tenant):
        """One pass across every identity column on the Member to
        catch any future addition that ships without a classification
        entry (defence in depth on top of the field-classification
        guard)."""
        user = JasminUserFactory()
        member = MemberFactory(
            user=user,
            first_name="Alice",
            last_name="Beispiel",
            company_name="Acme",
            email="alice@example.com",
            email_2="alice2@example.com",
            email_3="alice3@example.com",
            pickup_name="Alice B.",
            address="Marktplatz 1",
            zip_code="12345",
            city="Beispielstadt",
            country="DE",
            account_owner="Alice Beispiel",
            iban="DE89370400440532013000",
            note="internal note",
            birth_date=datetime.date(1985, 3, 14),
        )

        GDPRService.anonymize_user(user)

        member.refresh_from_db()
        # TOMBSTONE fields → "Gelöscht" (not NULL — so the row still
        # has a sortable name on the legal Mitgliederliste).
        assert member.first_name == "Gelöscht"
        assert member.last_name == "Gelöscht"
        # PII_IMMEDIATE fields → NULL / empty.
        assert member.company_name is None
        assert member.email is None
        assert member.email_2 is None
        assert member.email_3 is None
        assert member.pickup_name is None
        assert member.address is None
        assert member.zip_code is None
        assert member.city is None
        assert member.country is None
        assert member.account_owner is None
        assert member.note is None
        assert member.birth_date is None
        # iban: PII_IMMEDIATE with explicit empty-string replacement
        # (not None) because the IBANValidator on the column rejects
        # None; "" survives validation + leaks zero info.
        assert str(member.iban) == ""

    def test_anonymise_persists_scrub_when_member_already_cancelled(self, tenant):
        """Production flow: admin cancels the member via
        ``cancel_member_with_coop_shares`` (stamping member + cascading
        the shares' cancellation timestamps), THEN runs the GDPR
        anonymisation. Locks end-to-end:

        - ``_anonymize_member`` scrubs PII columns + sets
          ``is_active=False`` and persists with ``member.save()`` —
          NOT lost by a follow-on ``save(update_fields=[3])``.
        - Pre-existing cancellation timestamps on the shares are
          preserved (the soft-retention rule: anonymisation doesn't
          rewrite historical equity dates).

        Retention means ``check_retention_blocks`` only passes once the
        equity is both cancelled AND paid back (GenG §73 Auseinandersetzung)
        — that's why the production flow cancels, returns the equity, then
        deletes.
        """
        from apps.commissioning.services.member_cancellation import (
            cancel_member_with_coop_shares,
        )

        user = JasminUserFactory(email="alice@example.com")
        member = MemberFactory(
            user=user,
            first_name="Alice",
            email="alice@example.com",
            birth_date=datetime.date(1985, 3, 14),
        )
        share_a = CoopShareFactory(member=member)
        share_b = CoopShareFactory(member=member)

        # Step 1 — office cancels the member (cascade stamps shares).
        cancel_member_with_coop_shares(member)
        # Equity is returned to the member — office stamps ``paid_back_date``.
        # Until this happens the GenG §73 retention obligation blocks
        # anonymisation even though the shares are already cancelled.
        CoopShare.objects.filter(member=member).update(
            paid_back_date=F("payback_due_date")
        )
        member.refresh_from_db()
        share_a.refresh_from_db()
        share_b.refresh_from_db()
        cancelled_at_snapshot = member.cancelled_at
        assert share_a.cancelled_at == cancelled_at_snapshot

        # Step 2 — GDPR anonymisation runs (retention check now passes
        # because the equity is cancelled AND paid back).
        GDPRService.anonymize_user(user)

        member.refresh_from_db()
        share_a.refresh_from_db()
        share_b.refresh_from_db()

        # (1) Scrub committed.
        assert member.first_name == "Gelöscht"
        assert member.email is None
        assert member.birth_date is None
        assert member.is_active is False
        # (2) Member's cancellation date is the one from Step 1,
        # NOT overwritten by anonymisation.
        assert member.cancelled_at == cancelled_at_snapshot
        # (3) Share dates also preserved — equity-history integrity.
        assert share_a.cancelled_at == cancelled_at_snapshot
        assert share_b.cancelled_at == cancelled_at_snapshot

    def test_anonymise_cancels_member_when_no_shares_held(self, tenant):
        """Edge case: trial member or fresh sign-up with zero
        CoopShares. Retention check passes immediately; the cascade
        runs inside ``_anonymize_member`` and stamps the Member's
        ``cancelled_at``. Sanity-check the safety-net branch."""
        user = JasminUserFactory(email="bob@example.com")
        member = MemberFactory(user=user, first_name="Bob")
        assert not CoopShare.objects.filter(member=member).exists()
        assert member.cancelled_at is None

        GDPRService.anonymize_user(user)

        member.refresh_from_db()
        assert member.first_name == "Gelöscht"
        assert member.cancelled_at is not None
        assert member.cancelled_effective_at is not None

    def test_cancellation_reasons_scrubbed_on_anonymize(self, tenant):
        """Free-text cancellation reasons on the Member AND its
        Subscription / MemberLoan rows are scrubbed on erasure (they routinely
        hold PII)."""
        from apps.commissioning.models import MemberLoan, Subscription
        from apps.commissioning.tests.factories import SubscriptionFactory

        user = JasminUserFactory(email="reason@example.com")
        member = MemberFactory(
            user=user, cancellation_reason="moved to Berliner Str. 5"
        )
        # An ended (past) subscription — the realistic state for one carrying a
        # cancellation reason; also keeps it out of the active-subscription
        # retention block so anonymization can proceed.
        sub = SubscriptionFactory(
            member=member,
            cancellation_reason="too expensive",
            valid_from=datetime.date(2020, 1, 6),  # Monday
            valid_until=datetime.date(2020, 12, 27),  # Sunday
            default_delivery_station_day=None,  # skip the factory's DSD-coverage check
            # Already cancelled (past) — keeps it out of the active-subscription
            # retention block and out of the anonymize cancel-cascade.
            cancelled_at=datetime.datetime(2020, 6, 1, tzinfo=datetime.UTC),
            cancelled_effective_at=datetime.date(2020, 6, 7),
        )
        loan = MemberLoan.objects.create(
            member=member,
            amount=100,
            interest_rate=0,
            start_date=datetime.date(2020, 1, 6),
            cancelled_reason="changed my mind",
        )

        GDPRService.anonymize_user(user)

        member.refresh_from_db()
        sub.refresh_from_db()
        loan.refresh_from_db()
        assert member.cancellation_reason is None
        assert Subscription.objects.get(pk=sub.pk).cancellation_reason is None
        assert loan.cancelled_reason is None

    def test_reseller_name_scrubbed_in_background_job_results(self, tenant):
        """The anonymized reseller's name, copied into offer
        bulk-send ``BackgroundJob.result`` payloads, is blanked while the
        ``reseller_id`` (a non-PII correlator) is preserved."""
        from apps.commissioning.tests.factories import ResellerFactory
        from apps.notifications.models import BackgroundJob

        user = JasminUserFactory(email="reseller@example.com")
        reseller = ResellerFactory(linked_user=user)
        job = BackgroundJob.objects.create(
            kind="offer_bulk_send",
            result={
                "results": [
                    {
                        "reseller_id": str(reseller.id),
                        "reseller_name": "Bio Müller GmbH",
                        "success": True,
                    }
                ]
            },
        )

        GDPRService.anonymize_user(user)

        job.refresh_from_db()
        item = job.result["results"][0]
        assert item["reseller_name"] == "[anonymised]"
        assert item["reseller_id"] == str(reseller.id)

    def test_auditlog_diffs_are_scrubbed(self, tenant):
        """Historical auditlog entries hold pre-anonymization values
        in ``changes`` (e.g. a first_name edit stores old AND new
        name) and the person's name in ``object_repr``. Both must be
        wiped by ``anonymize_user`` — Member's ``mask_fields`` don't
        cover its name columns."""
        from auditlog.models import LogEntry

        user = JasminUserFactory(email="carla@example.com")
        member = MemberFactory(user=user, first_name="Carla", last_name="Beispiel")
        # Produce an UPDATE diff that contains the real name.
        member.first_name = "Carlotta"
        member.save()

        entries = LogEntry.objects.get_for_object(member)
        assert entries.exists(), (
            "Member saves should produce auditlog entries — is the "
            "auditlog registration in commissioning/apps.py gone?"
        )
        assert any(entry.changes and "first_name" in entry.changes for entry in entries)

        GDPRService.anonymize_user(user)

        for entry in LogEntry.objects.get_for_object(member):
            assert entry.changes is None
            assert entry.object_repr == "[anonymised]"

    def test_auditlog_scrub_covers_member_linked_models(self, tenant):
        """The scrub must reach every auditlog-registered model whose
        ``object_repr`` names the member, not just the Member row — a
        CoopShare's repr is ``"CoopShare N for <member>"``."""
        from auditlog.models import LogEntry

        from apps.commissioning.services.member_cancellation import (
            cancel_member_with_coop_shares,
        )

        user = JasminUserFactory(email="dora@example.com")
        member = MemberFactory(user=user, first_name="Dora", last_name="Beispiel")
        share = CoopShareFactory(member=member)
        # The CoopShare repr embeds the member name in object_repr.
        share_entries = LogEntry.objects.get_for_object(share)
        assert share_entries.exists()
        assert any("Dora" in (e.object_repr or "") for e in share_entries)

        # Production flow: cancel the member and return the equity
        # (clears the CoopShare retention block) before anonymising. The
        # CoopShare ROW stays for the GenG paper trail — but its auditlog
        # repr must lose the member name.
        cancel_member_with_coop_shares(member)
        CoopShare.objects.filter(member=member).update(
            paid_back_date=F("payback_due_date")
        )
        GDPRService.anonymize_user(user)

        for entry in LogEntry.objects.get_for_object(share):
            assert entry.object_repr == "[anonymised]", (
                "CoopShare auditlog repr still names the deleted member — "
                "_scrub_auditlog_entries coverage drifted from "
                "auditlog.register(...) in commissioning/apps.py"
            )


@pytest.mark.django_db
class TestCoopShareTransferAnonymization:
    def test_transfer_notes_naming_the_member_are_scrubbed_on_both_sides(self, tenant):
        """A transfer's note and the notes of the rows it created name both
        members, so anonymising either one scrubs them on both sides. In the audit
        log the member's own rows are scrubbed whole; the transfer and the other
        member's row only lose the note. Amounts and dates stay."""
        from auditlog.models import LogEntry

        from apps.commissioning.services.member_cancellation import (
            cancel_member_with_coop_shares,
        )

        user = JasminUserFactory(email="erik@example.com")
        member = MemberFactory(user=user, first_name="Erik", last_name="Beispiel")
        other = MemberFactory(first_name="Olga", last_name="Other")
        transfer = CoopShareTransfer.objects.create(
            from_member=member,
            to_member=other,
            amount_of_coop_shares=2,
            transfer_date=datetime.date(2026, 3, 2),
            note="sold to Olga",
        )
        given = CoopShareFactory(
            member=member,
            amount_of_coop_shares=-2,
            transfer=transfer,
            note="Transfer to Olga Other",
        )
        received = CoopShareFactory(
            member=other,
            amount_of_coop_shares=2,
            transfer=transfer,
            note="Transfer from Erik Beispiel",
        )
        unrelated = CoopShareFactory(
            member=other, amount_of_coop_shares=3, note="paid in cash"
        )
        assert LogEntry.objects.get_for_object(transfer).exists()
        assert LogEntry.objects.get_for_object(received).exists()

        cancel_member_with_coop_shares(member)
        CoopShare.objects.filter(member=member).update(
            paid_back_date=F("payback_due_date")
        )
        GDPRService.anonymize_user(user)

        for row in (transfer, given, received, unrelated):
            row.refresh_from_db()
        assert transfer.note is None
        assert given.note is None
        assert received.note is None
        assert transfer.amount_of_coop_shares == 2
        assert received.amount_of_coop_shares == 2
        assert unrelated.note == "paid in cash"
        for entry in LogEntry.objects.get_for_object(given):
            assert entry.changes is None
            assert entry.object_repr == "[anonymised]"
        for obj in (transfer, received):
            entries = LogEntry.objects.get_for_object(obj)
            assert entries.exists()
            for entry in entries:
                assert entry.object_repr != "[anonymised]"
                assert "note" not in (entry.changes or {})


@pytest.mark.django_db
class TestSepaExportPurge:
    """A billing run's pain.008 file embeds the debtor name + IBAN in
    cleartext. When a member is anonymised (10y post-exit) every run that
    debited them is itself past retention, so anonymisation must erase the
    on-disk file while keeping the BillingRun row (the financial record)."""

    def test_past_retention_sepa_file_is_erased_row_kept(self, tenant):
        from datetime import timedelta
        from decimal import Decimal

        from django.core.files.base import ContentFile
        from django.utils import timezone

        from apps.commissioning.tests.factories import SubscriptionFactory
        from apps.gdpr.tasks import _retention_cutoff
        from apps.payments.models import (
            BillingRun,
            BillingRunStatus,
            ChargeSchedule,
            ChargeStatus,
            PaymentMethodOptions,
        )

        user = JasminUserFactory()
        member = MemberFactory(user=user)
        old = _retention_cutoff() - timedelta(days=30)  # comfortably past 10y

        run = BillingRun.objects.create(
            period_start=old,
            period_end=old + timedelta(days=27),
            collection_date=old + timedelta(days=5),
            payment_method=PaymentMethodOptions.SEPA_DIRECT_DEBIT,
            status=BillingRunStatus.DRAFT,
            total_amount=Decimal("25.00"),
            charge_count=1,
            msg_id="BR-OLD",
        )
        run.sepa_xml_export.save("old.xml", ContentFile(b"<Document/>"), save=True)
        # created_at is auto_now_add (== now); .update() bypasses it to back-date.
        BillingRun.objects.filter(pk=run.pk).update(
            created_at=timezone.make_aware(
                datetime.datetime.combine(old, datetime.time.min)
            )
        )
        ChargeSchedule.objects.create(
            member=member,
            subscription=SubscriptionFactory(),
            period_start=old,
            period_end=old + timedelta(days=27),
            due_date=old,
            expected_amount=Decimal("25.00"),
            currency="EUR",
            description="old charge",
            status=ChargeStatus.PAID,  # terminal — not an open retention block
            billing_run=run,
        )
        assert run.sepa_xml_export.name  # file present before anonymisation

        GDPRService.anonymize_user(user)

        run.refresh_from_db()
        assert not run.sepa_xml_export  # plaintext SEPA file erased
        assert BillingRun.objects.filter(pk=run.pk).exists()  # record kept

    def test_within_retention_sepa_file_is_kept(self, tenant):
        # Belt-and-braces gate: a run still inside its retention window must NOT
        # be erased even if (hypothetically) it bills an anonymised member.
        from datetime import timedelta
        from decimal import Decimal

        from django.core.files.base import ContentFile
        from django.utils import timezone

        from apps.commissioning.tests.factories import SubscriptionFactory
        from apps.payments.models import (
            BillingRun,
            BillingRunStatus,
            ChargeSchedule,
            ChargeStatus,
            PaymentMethodOptions,
        )

        user = JasminUserFactory()
        member = MemberFactory(user=user)
        recent = timezone.localdate() - timedelta(days=30)  # well within 10y

        run = BillingRun.objects.create(
            period_start=recent,
            period_end=recent + timedelta(days=27),
            collection_date=recent + timedelta(days=5),
            payment_method=PaymentMethodOptions.SEPA_DIRECT_DEBIT,
            status=BillingRunStatus.DRAFT,
            total_amount=Decimal("25.00"),
            charge_count=1,
            msg_id="BR-RECENT",
        )
        run.sepa_xml_export.save("recent.xml", ContentFile(b"<Document/>"), save=True)
        ChargeSchedule.objects.create(
            member=member,
            subscription=SubscriptionFactory(),
            period_start=recent,
            period_end=recent + timedelta(days=27),
            due_date=recent,
            expected_amount=Decimal("25.00"),
            currency="EUR",
            description="recent charge",
            status=ChargeStatus.PAID,  # terminal — not an open retention block
            billing_run=run,
        )

        GDPRService.anonymize_user(user)

        run.refresh_from_db()
        assert run.sepa_xml_export.name  # still within retention — kept


@pytest.mark.django_db
class TestCancellationCommittedDuringErasure:
    def test_the_office_cancellation_is_kept(self, tenant):
        """The erasure's copy of the member predates an office cancellation.
        Erasing keeps that cancellation instead of writing the stale copy back
        and cancelling again, dated on the day of the erasure."""
        member = MemberFactory(entry_date=datetime.date(2026, 1, 5))
        subject = ErasureSubject.of_member(Member.objects.get(pk=member.pk))

        with time_machine.travel(datetime.datetime(2026, 9, 7, 12, 0), tick=False):
            cancel_member_with_coop_shares(
                Member.objects.get(pk=member.pk),
                cancelled_effective_at=datetime.date(2026, 9, 30),
                notify=False,
            )
        cancelled_at = Member.objects.get(pk=member.pk).cancelled_at

        with time_machine.travel(datetime.datetime(2026, 10, 5, 12, 0), tick=False):
            GDPRService.anonymize_subject(subject)

        member.refresh_from_db()
        assert member.cancelled_at == cancelled_at
        assert member.cancelled_effective_at == datetime.date(2026, 9, 30)
        assert member.first_name == "Gelöscht"


@pytest.mark.django_db
class TestAuditEntriesOfDeletedRecords:
    """Records deleted before the erasure are gone from every queryset, but
    their audit entries still name the member: the erasure finds them through
    the foreign keys those entries store."""

    def test_entries_of_deleted_records_are_scrubbed(self, tenant):
        from auditlog.models import LogEntry
        from django.contrib.contenttypes.models import ContentType

        from apps.commissioning.models import ShareDelivery, Subscription
        from apps.commissioning.tests.factories import (
            ShareDeliveryFactory,
            ShareFactory,
            SubscriptionFactory,
        )

        def entries_of(model, pk):
            return LogEntry.objects.filter(
                content_type=ContentType.objects.get_for_model(model),
                object_pk=str(pk),
            )

        user = JasminUserFactory(email="hanna@example.com")
        member = MemberFactory(user=user, first_name="Hanna", last_name="Beispiel")
        share = CoopShareFactory(member=member)
        subscription = SubscriptionFactory(member=member, admin_confirmed=False)
        # Reuse the subscription's delivery day: a fresh one trips the
        # ``sharesdeliveryday_one_open_per_day_number`` guard.
        station_day = subscription.default_delivery_station_day
        delivery = ShareDeliveryFactory(
            subscription=subscription,
            share=ShareFactory(
                delivery_day=station_day.delivery_day,
                share_type_variation=subscription.share_type_variation,
            ),
            delivery_station_day=station_day,
        )
        other_share = CoopShareFactory(
            member=MemberFactory(first_name="Olga", last_name="Other")
        )
        # ``delete()`` clears the instance's pk, so keep them first.
        deleted = [
            (CoopShare, share.pk),
            (ShareDelivery, delivery.pk),
            (Subscription, subscription.pk),
        ]
        other_share_pk = other_share.pk
        delivery.delete()
        subscription.delete()
        share.delete()
        other_share.delete()
        assert any(
            "Hanna" in entry.object_repr
            for entry in entries_of(CoopShare, deleted[0][1])
        )

        GDPRService.anonymize_user(user)

        for model, pk in deleted:
            entries = entries_of(model, pk)
            assert entries.filter(action=LogEntry.Action.DELETE).exists()
            for entry in entries:
                assert entry.changes is None
                assert entry.object_repr == "[anonymised]"
        # Another member's deleted record keeps its history.
        other_entries = entries_of(CoopShare, other_share_pk)
        assert other_entries.exists()
        for entry in other_entries:
            assert entry.object_repr != "[anonymised]"
            assert entry.changes is not None

    def test_entries_the_member_made_lose_their_email_and_address(self, tenant):
        from auditlog.context import set_actor
        from auditlog.models import LogEntry

        user = JasminUserFactory(email="ines@example.com")
        member = MemberFactory(user=user)
        with set_actor(user, remote_addr="203.0.113.7"):
            member.pickup_name = "Ines"
            member.save()
        made = LogEntry.objects.filter(actor=user)
        assert made.filter(actor_email="ines@example.com").exists()

        GDPRService.anonymize_user(user)

        assert made.exists()
        for entry in made:
            assert entry.actor_email is None
            assert entry.remote_addr is None
