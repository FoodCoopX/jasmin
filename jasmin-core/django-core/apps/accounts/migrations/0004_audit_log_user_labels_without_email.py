"""Relabel the audit log's entries about users without their email address.

django-auditlog stores ``str()`` of the logged instance as ``object_repr``. For
a user that was the username, which is the email address. ``JasminUser`` now
prints as ``User <pk>``, and this rewrites the stored labels the same way.
Entries an erasure has already blanked keep their ``[anonymised]`` label.

Irreversible on purpose: the addresses must not come back, so the reverse is a
no-op.
"""

from django.db import migrations
from django.db.models import F, TextField, Value
from django.db.models.functions import Concat

# Kept in step with ``JasminUser.__str__`` and the erasure's label; a migration
# doesn't import app code, which may change after it has run.
LABEL_PREFIX = "User "
ANONYMISED_LABEL = "[anonymised]"


def relabel_user_entries(apps, schema_editor):
    ContentType = apps.get_model("contenttypes", "ContentType")
    LogEntry = apps.get_model("auditlog", "LogEntry")
    content_type = ContentType.objects.filter(
        app_label="accounts", model="jasminuser"
    ).first()
    if content_type is None:
        return
    LogEntry.objects.filter(content_type=content_type).exclude(
        object_repr=ANONYMISED_LABEL
    ).update(
        object_repr=Concat(
            Value(LABEL_PREFIX), F("object_pk"), output_field=TextField()
        )
    )


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0003_alter_jasminuser_id"),
        ("auditlog", "0017_add_actor_email"),
        ("contenttypes", "0002_remove_content_type_name"),
    ]

    operations = [
        migrations.RunPython(relabel_user_entries, migrations.RunPython.noop),
    ]
