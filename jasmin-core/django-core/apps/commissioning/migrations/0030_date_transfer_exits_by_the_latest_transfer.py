"""Date the exit of a member emptied by a coop share transfer by their latest
transfer.

An emptying transfer cancels the giver and closes the rows it settles, both
effective on the giver's latest transfer date, given or received: the shares of
a transfer stop counting for one side on the date they start counting for the
other, so the exit can't come before any of them. Rows stored by an emptying
transfer dated before another transfer of the giver carry the earlier date,
which leaves the shares of the later transfer held by nobody in between. This
moves the member's exit and those rows to the latest transfer date. Unconfirmed
rows the cancellation closed keep their dates: they never count, and their
payback due date was derived from them.

Irreversible on purpose: the earlier dates were wrong, so the reverse is a
no-op.
"""

from django.db import migrations
from django.db.models import Max, Q


def date_exits_by_the_latest_transfer(apps, schema_editor):
    Member = apps.get_model("commissioning", "Member")
    CoopShare = apps.get_model("commissioning", "CoopShare")
    CoopShareTransfer = apps.get_model("commissioning", "CoopShareTransfer")

    emptied_member_ids = set(
        CoopShare.objects.filter(settled_by_transfer__isnull=False).values_list(
            "member_id", flat=True
        )
    )
    members = Member.objects.filter(
        pk__in=emptied_member_ids, cancelled_effective_at__isnull=False
    ).only("pk", "cancelled_effective_at")
    for member in members:
        latest = CoopShareTransfer.objects.filter(
            Q(from_member_id=member.pk) | Q(to_member_id=member.pk)
        ).aggregate(latest=Max("transfer_date"))["latest"]
        if latest is None or member.cancelled_effective_at >= latest:
            continue
        CoopShare.objects.filter(
            member_id=member.pk,
            settled_by_transfer__isnull=False,
            cancelled_effective_at__lt=latest,
        ).update(cancelled_effective_at=latest)
        Member.objects.filter(pk=member.pk).update(cancelled_effective_at=latest)


class Migration(migrations.Migration):
    dependencies = [
        ("commissioning", "0029_season_season_no_overlap"),
    ]

    operations = [
        migrations.RunPython(
            date_exits_by_the_latest_transfer, migrations.RunPython.noop
        ),
    ]
