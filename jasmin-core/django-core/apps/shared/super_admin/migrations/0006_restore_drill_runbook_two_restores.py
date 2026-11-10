"""Describe both restores in the restore-drill runbook.

The drill restores the backup twice, the second time over a migrated copy of
the first, which it keeps as the replaced database, so it needs room for two
copies of the database. The description 0003 gave the existing row names one
restore and no room, so it is rewritten here.
"""

from django.db import migrations

RESTORE_DRILL_RUNBOOK = (
    "Export BACKUP_ENCRYPTION_KEY — paste it from the password manager, "
    "which also proves the stored copy is current — and run\n"
    "  ./scripts/restore_drill.sh\n"
    "It restores the newest backup into a throwaway database through "
    "backups/restore.sh, compares row counts with production, dry-runs the "
    "GDPR erasure replay, restores the backup a second time over that migrated "
    "copy, which it keeps as the replaced database, and unpacks the newest "
    "media archive; it writes its log to backups/restore-drills/. Check the "
    "room first: docker's storage needs about two copies of the database plus "
    "the decrypted dump, and $TMPDIR one unpacked copy of the media. Mark this "
    "item done with the result and the log's file name in the notes. A failed "
    "drill is an incident: find the cause before you sign off."
)


def _update_runbook(apps, schema_editor):
    OpsChecklistItem = apps.get_model("super_admin", "OpsChecklistItem")
    OpsChecklistItem.objects.filter(kind="restore_drill").update(
        description=RESTORE_DRILL_RUNBOOK
    )


class Migration(migrations.Migration):

    dependencies = [
        ("super_admin", "0005_bunny_runbook_origin_secret"),
    ]

    operations = [
        # Going back keeps this text: the drill restored twice before this
        # migration as well, so the text holds for the code a rollback runs.
        migrations.RunPython(_update_runbook, migrations.RunPython.noop),
    ]
