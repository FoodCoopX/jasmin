"""Give every share size the packing its farm's stored pure mode gave it.

Each size's own ``is_packed_bulk`` decides how it is packed, and the farm's
packing mode follows from its sizes. A stored "boxes" or "bulk" mode used to
decide for every size whatever its flag, so a size may hold a flag from an
earlier mode. Setting every flag to what the stored pure mode packed keeps
each size, and with it the farm's mode, packed as before. A farm without
settings counted as "boxes"; a farm in "mixed" keeps its flags.

Irreversible on purpose: the flags it overwrites decided nothing, so the
reverse is a no-op.
"""

from django.db import migrations
from django.db.models import Q
from django.utils import timezone


def align_size_packing_with_stored_mode(apps, schema_editor):
    tenant = (
        apps.get_model("tenants", "Tenant")
        .objects.filter(schema_name=schema_editor.connection.schema_name)
        .first()
    )
    if tenant is None:
        return
    now = timezone.now()
    settings = (
        apps.get_model("tenants", "TenantSettings")
        .objects.filter(
            Q(valid_until__gt=now) | Q(valid_until__isnull=True),
            tenant=tenant,
            valid_from__lte=now,
        )
        .order_by("-valid_from", "-created_at", "-id")
        .first()
    )
    mode = settings.packing_mode if settings is not None else "BOXES"
    if mode == "MIXED":
        return
    apps.get_model("commissioning", "ShareTypeVariation").objects.update(
        is_packed_bulk=mode == "BULK"
    )


class Migration(migrations.Migration):
    dependencies = [
        ("commissioning", "0038_product_groups_and_market_prices"),
        ("tenants", "0025_tenantsettings_has_purchases"),
    ]

    operations = [
        migrations.RunPython(
            align_size_packing_with_stored_mode, migrations.RunPython.noop
        ),
    ]
