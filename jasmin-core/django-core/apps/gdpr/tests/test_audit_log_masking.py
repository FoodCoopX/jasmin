"""Audit-log masking for every auditlog registration with ``mask_fields``.

Change diffs are kept indefinitely, so the old and the new value of a masked
field are stored as ``AUDIT_LOG_MASK`` — nothing of the value, not even the
second half django-auditlog's own default mask keeps. The gdpr migration
``0003_mask_audit_log_values_in_full`` rewrites the entries written before
the same way.
"""

from __future__ import annotations

import datetime
import importlib
import json

import pytest
from auditlog.models import LogEntry
from auditlog.registry import auditlog
from django.apps import apps as django_apps
from django.contrib.contenttypes.models import ContentType

from apps.accounts.models import JasminUser
from apps.commissioning.models import ContactEntity, CoopShare, Member, Reseller
from apps.commissioning.tests.factories import (
    ContactEntityFactory,
    JasminUserFactory,
    MemberFactory,
    ResellerFactory,
)
from apps.payments.models import BillingProfile, PaymentMethodOptions
from apps.shared.pii_masking import AUDIT_LOG_MASK

mask_migration = importlib.import_module(
    "apps.gdpr.migrations.0003_mask_audit_log_values_in_full"
)

# A new value for every masked field, unlike anything the factories set.
NEW_VALUES = {
    Member: {
        "iban": "DE89370400440532013000",
        "email": "masked.member@example.com",
        "email_2": "masked.member.2@example.com",
        "email_3": "masked.member.3@example.com",
        "address": "Maskenweg 12",
        "zip_code": "12345",
        "city": "Maskenstadt",
        "account_owner": "Anna Maskiert",
        "note": "Calls only in the evening",
        "cancellation_reason": "Moving to Maskenstadt",
        "birth_date": datetime.date(1985, 3, 14),
    },
    ContactEntity: {
        "iban": "DE89370400440532013000",
        "email": "masked.contact@example.com",
        "email_2": "masked.contact.2@example.com",
        "email_3": "masked.contact.3@example.com",
        "order_email": "masked.orders@example.com",
        "phone": "+49 30 1234567",
        "phone_2": "+49 30 7654321",
        "phone_3": "+49 171 2345678",
        "address": "Hofweg 7",
        "zip_code": "54321",
        "city": "Hofstadt",
    },
    Reseller: {
        "invoice_address": "Rechnungsweg 3",
        "invoice_plz": "67890",
        "invoice_city": "Rechnungsstadt",
        "invoice_email": "masked.invoices@example.com",
        "note": "Pays on the first of the month",
    },
    BillingProfile: {
        "iban": "AT611904300234573201",
        "account_holder": "Bea Maskiert",
        "sepa_mandate_reference": "MND-MASKED-0001",
    },
    JasminUser: {
        "email": "masked.user@example.com",
        "username": "masked.user@example.com",
        "first_name": "Maskiertina",
        "last_name": "Maskenfrau",
        "last_login_ip": "203.0.113.7",
    },
}


def _create(model):
    if model is Member:
        return MemberFactory(user=JasminUserFactory())
    if model is ContactEntity:
        return ContactEntityFactory()
    if model is Reseller:
        return ResellerFactory()
    if model is BillingProfile:
        member = MemberFactory(user=JasminUserFactory())
        return BillingProfile.objects.create(
            member=member,
            payment_method=PaymentMethodOptions.SEPA_DIRECT_DEBIT,
            iban="DE89370400440532013000",
            account_holder="Anna Muster",
            sepa_mandate_reference=f"MND-{member.pk}",
            sepa_mandate_signed_at=datetime.date(2026, 1, 1),
            is_active=True,
        )
    return JasminUserFactory()


@pytest.mark.django_db
@pytest.mark.parametrize("model", list(NEW_VALUES), ids=lambda model: model.__name__)
def test_every_masked_field_is_stored_as_the_mask(tenant, model):
    mask_fields = auditlog.get_model_fields(model)["mask_fields"]
    # Every masked field is exercised here.
    assert sorted(NEW_VALUES[model]) == sorted(mask_fields)

    instance = _create(model)
    for field, value in NEW_VALUES[model].items():
        setattr(instance, field, value)
    instance.save()

    entry = (
        LogEntry.objects.get_for_object(instance)
        .filter(action=LogEntry.Action.UPDATE)
        .latest("timestamp")
    )
    for field in mask_fields:
        old, new = entry.changes[field]
        assert new == AUDIT_LOG_MASK, field
        assert old in (AUDIT_LOG_MASK, "None", ""), field
    stored = json.dumps(entry.changes)
    for value in NEW_VALUES[model].values():
        assert str(value) not in stored


@pytest.mark.django_db
class TestMaskInFullMigration:
    @staticmethod
    def _entry(
        model,
        object_pk,
        changes,
        serialized_data=None,
        action=LogEntry.Action.UPDATE,
    ):
        return LogEntry(
            content_type=ContentType.objects.get_for_model(model),
            object_pk=object_pk,
            object_repr="",
            action=action,
            changes=changes,
            changes_text=json.dumps(changes),
            serialized_data=serialized_data,
        )

    def test_masks_partially_masked_and_plain_values_in_full(self, tenant):
        member = MemberFactory(user=JasminUserFactory())
        entry = self._entry(
            Member,
            str(member.pk),
            {
                # auditlog's default mask kept the second half.
                "iban": ["***********40532013000", "DE89370400440532013000"],
                "email": ["None", "anna@example.com"],
                "birth_date": ["", "*****-03-14"],
                # Not a masked field of Member.
                "first_name": ["Anna", "Anne"],
            },
            serialized_data={
                "fields": {
                    "iban": "DE89370400440532013000",
                    "zip_code": None,
                    "first_name": "Anna",
                }
            },
        )
        entry.save()

        mask_migration.mask_in_full(django_apps, None)
        # A second run finds nothing left to change.
        mask_migration.mask_in_full(django_apps, None)

        entry.refresh_from_db()
        mask = mask_migration.MASK
        expected = {
            "iban": [mask, mask],
            "email": ["None", mask],
            "birth_date": ["", mask],
            "first_name": ["Anna", "Anne"],
        }
        assert entry.changes == expected
        assert json.loads(entry.changes_text) == expected
        assert entry.serialized_data == {
            "fields": {"iban": mask, "zip_code": None, "first_name": "Anna"}
        }

    def test_old_entries_read_like_new_ones_afterwards(self, tenant, settings):
        """Entries written with auditlog's default mask match, once rewritten,
        the entries the callable writes for the same changes: a value set,
        cleared, created and deleted alike."""

        def record_changes():
            member = MemberFactory(
                user=JasminUserFactory(), iban="DE89370400440532013000"
            )
            member.email = None
            member.save()
            member.email = "second@example.com"
            member.save()
            contact = ContactEntityFactory(phone="+49 30 1234567")
            contact_pk = contact.pk
            contact.delete()
            return [
                *LogEntry.objects.get_for_object(member).order_by("pk"),
                *LogEntry.objects.filter(
                    content_type=ContentType.objects.get_for_model(ContactEntity),
                    object_pk=str(contact_pk),
                ).order_by("pk"),
            ]

        def masked_values(entries):
            result = []
            for entry in entries:
                entry.refresh_from_db()
                model = entry.content_type.model_class()
                fields = auditlog.get_model_fields(model)["mask_fields"]
                result.append(
                    (
                        entry.action,
                        {f: v for f, v in entry.changes.items() if f in fields},
                    )
                )
            return result

        callable_path = settings.AUDITLOG_MASK_CALLABLE
        settings.AUDITLOG_MASK_CALLABLE = None
        old_entries = record_changes()
        settings.AUDITLOG_MASK_CALLABLE = callable_path
        new_entries = record_changes()
        # The default mask stored the empty values as "**ne".
        assert "**ne" in json.dumps([entry.changes for entry in old_entries])

        mask_migration.mask_in_full(django_apps, None)

        assert masked_values(old_entries) == masked_values(new_entries)

    def test_reads_the_default_mask_of_an_empty_value_by_position_and_field(
        self, tenant
    ):
        """A phone field may hold "none", which the default mask also turned
        into "**ne"; an email field can't."""
        action = LogEntry.Action
        created = self._entry(
            ContactEntity, "c-1", {"phone_2": ["**ne", "**ne"]}, action=action.CREATE
        )
        updated = self._entry(
            ContactEntity,
            "c-1",
            {
                "phone_2": ["**ne", "*******1234567"],
                "email": ["**ne", "*********ample.com"],
            },
        )
        deleted = self._entry(
            ContactEntity, "c-1", {"phone_2": ["**ne", "**ne"]}, action=action.DELETE
        )
        for entry in (created, updated, deleted):
            entry.save()

        mask_migration.mask_in_full(django_apps, None)

        mask = mask_migration.MASK
        created.refresh_from_db()
        assert created.changes == {"phone_2": ["None", mask]}
        updated.refresh_from_db()
        assert updated.changes == {
            "phone_2": [mask, mask],
            "email": ["None", mask],
        }
        deleted.refresh_from_db()
        assert deleted.changes == {"phone_2": [mask, "None"]}

    def test_masks_by_the_fields_of_the_entry_s_own_model(self, tenant):
        """``note`` is masked on a Reseller but plain audit data on a CoopShare."""
        reseller_entry = self._entry(Reseller, "r-1", {"note": ["old", "new"]})
        coop_share_entry = self._entry(CoopShare, "c-1", {"note": ["old", "new"]})
        reseller_entry.save()
        coop_share_entry.save()

        mask_migration.mask_in_full(django_apps, None)

        reseller_entry.refresh_from_db()
        coop_share_entry.refresh_from_db()
        mask = mask_migration.MASK
        assert reseller_entry.changes == {"note": [mask, mask]}
        assert coop_share_entry.changes == {"note": ["old", "new"]}

    def test_masks_entries_beyond_one_batch(self, tenant):
        count = mask_migration.BATCH_SIZE + 1
        LogEntry.objects.bulk_create(
            self._entry(JasminUser, f"u-{n}", {"email": ["None", f"u{n}@example.com"]})
            for n in range(count)
        )

        mask_migration.mask_in_full(django_apps, None)

        entries = LogEntry.objects.filter(
            content_type=ContentType.objects.get_for_model(JasminUser),
            object_pk__startswith="u-",
        )
        assert entries.count() == count
        assert all(
            entry.changes == {"email": ["None", mask_migration.MASK]}
            for entry in entries
        )
