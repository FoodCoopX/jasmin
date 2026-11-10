"""Clear the rejection stamp of rows that are confirmed.

A confirm lifts an earlier rejection, but rows confirmed after a rejection
before it did kept their ``admin_rejected_at``. Everything that reads the stamp
then treats a confirmed row as rejected: such a member sees only "Log out" in
the portal and receives no coop-share transfers, and such a subscription
counts for neither capacity nor renewal.

Irreversible on purpose: the stamps were wrong, so the reverse is a no-op.
"""

from django.db import migrations

CONFIRMABLE_MODELS = ("Member", "Subscription", "CoopShare", "MemberLoan")


def clear_rejection_stamps_of_confirmed_rows(apps, schema_editor):
    for model_name in CONFIRMABLE_MODELS:
        apps.get_model("commissioning", model_name).objects.filter(
            admin_confirmed=True, admin_rejected_at__isnull=False
        ).update(admin_rejected_at=None, admin_rejection_reason=None)


class Migration(migrations.Migration):
    dependencies = [
        ("commissioning", "0035_purchase_unique_per_seller_and_storage"),
    ]

    operations = [
        migrations.RunPython(
            clear_rejection_stamps_of_confirmed_rows, migrations.RunPython.noop
        ),
    ]
