"""Mask the audit log's stored values of masked fields in full.

New entries are masked in full by ``AUDITLOG_MASK_CALLABLE``, which leaves an
empty value as it is. Rows written before carry django-auditlog's default mask,
which keeps the second half of each value (most of an IBAN), or, written before
a field was masked at all, the plain value. This rewrites those values as the
callable writes them.

The default mask also turned an empty value, ``"None"``, into ``"**ne"``. On the
old side of a creation and the new side of a deletion it always is one, and is
written back as ``"None"``; on their other sides it never is, as auditlog leaves
out a field that is empty on both. In an update it is ``"None"`` on fields whose
format is checked — IBANs, email addresses, dates, IP addresses — and masked on
the rest, where it may stand for a value such as "Anne".

Irreversible on purpose: the original values must not come back, so the
reverse is a no-op.
"""

import json

from django.db import migrations

# Kept in step with ``apps.shared.pii_masking.mask_for_audit_log``; a migration
# doesn't import app code, which may change after it has run.
MASK = "********"
EMPTY = ("", "None")
# django-auditlog's default mask of an empty value: the second half of "None".
DEFAULT_MASK_OF_EMPTY = "**ne"
# ``LogEntry.Action`` values.
CREATE = 0
DELETE = 2
# Masked fields whose format is checked, so no value of theirs is four characters
# ending in "ne": on them the default mask's "**ne" is always an empty value.
FORMAT_CHECKED_FIELDS = {
    ("commissioning", "member"): ("iban", "email", "birth_date"),
    ("commissioning", "contactentity"): ("iban", "email", "email_3", "order_email"),
    ("payments", "billingprofile"): ("iban",),
    ("accounts", "jasminuser"): ("email", "last_login_ip"),
}

# The ``mask_fields`` of each auditlog registration, by (app_label, model).
MASKED_FIELDS = {
    ("commissioning", "member"): (
        "iban",
        "email",
        "email_2",
        "email_3",
        "address",
        "zip_code",
        "city",
        "account_owner",
        "note",
        "cancellation_reason",
        "birth_date",
    ),
    ("commissioning", "contactentity"): (
        "iban",
        "email",
        "email_2",
        "email_3",
        "order_email",
        "phone",
        "phone_2",
        "phone_3",
        "address",
        "zip_code",
        "city",
    ),
    ("commissioning", "reseller"): (
        "invoice_address",
        "invoice_plz",
        "invoice_city",
        "invoice_email",
        "note",
    ),
    ("payments", "billingprofile"): (
        "iban",
        "account_holder",
        "sepa_mandate_reference",
    ),
    ("accounts", "jasminuser"): (
        "email",
        "username",
        "first_name",
        "last_name",
        "last_login_ip",
    ),
}

BATCH_SIZE = 500


def _mask(value, *, default_mask_is_empty=False):
    if default_mask_is_empty and value == DEFAULT_MASK_OF_EMPTY:
        return "None"
    if not isinstance(value, str) or value in EMPTY:
        return value
    return MASK


def _default_mask_is_empty(model_key, field, action, side) -> bool:
    """Whether "**ne" on this side of this field's diff is an empty value."""
    if action == CREATE:
        return side == 0
    if action == DELETE:
        return side == 1
    return field in FORMAT_CHECKED_FIELDS.get(model_key, ())


def _mask_changes(changes, model_key, fields, action) -> bool:
    """Mask ``fields`` in a ``{field: [old, new]}`` diff in place."""
    changed = False
    for field in fields:
        values = changes.get(field)
        if isinstance(values, list):
            masked = [
                _mask(
                    value,
                    default_mask_is_empty=_default_mask_is_empty(
                        model_key, field, action, side
                    ),
                )
                for side, value in enumerate(values)
            ]
            if masked != values:
                changes[field] = masked
                changed = True
    return changed


def _mask_entry(entry, model_key, fields) -> bool:
    changed = False
    if isinstance(entry.changes, dict):
        changed |= _mask_changes(entry.changes, model_key, fields, entry.action)
    if entry.changes_text:
        try:
            text_changes = json.loads(entry.changes_text)
        except ValueError:
            text_changes = None
        if isinstance(text_changes, dict) and _mask_changes(
            text_changes, model_key, fields, entry.action
        ):
            entry.changes_text = json.dumps(text_changes)
            changed = True
    serialized = entry.serialized_data
    if isinstance(serialized, dict) and isinstance(serialized.get("fields"), dict):
        for field in fields:
            value = serialized["fields"].get(field)
            masked = _mask(value)
            if masked != value:
                serialized["fields"][field] = masked
                changed = True
    return changed


def mask_in_full(apps, schema_editor):
    ContentType = apps.get_model("contenttypes", "ContentType")
    LogEntry = apps.get_model("auditlog", "LogEntry")
    update_fields = ["changes", "changes_text", "serialized_data"]
    for model_key, fields in MASKED_FIELDS.items():
        app_label, model = model_key
        content_type = ContentType.objects.filter(
            app_label=app_label, model=model
        ).first()
        if content_type is None:
            continue
        entries = (
            LogEntry.objects.filter(content_type=content_type)
            .only("id", "action", *update_fields)
            .order_by("id")
        )
        batch = []
        for entry in entries.iterator(chunk_size=2000):
            if _mask_entry(entry, model_key, fields):
                batch.append(entry)
            if len(batch) >= BATCH_SIZE:
                LogEntry.objects.bulk_update(batch, update_fields)
                batch = []
        if batch:
            LogEntry.objects.bulk_update(batch, update_fields)


class Migration(migrations.Migration):
    dependencies = [
        ("gdpr", "0002_alter_deletionlog_id_alter_deletionrequest_id"),
        ("auditlog", "0017_add_actor_email"),
        ("contenttypes", "0002_remove_content_type_name"),
    ]

    operations = [
        migrations.RunPython(mask_in_full, migrations.RunPython.noop),
    ]
