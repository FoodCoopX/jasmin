from decimal import ROUND_HALF_UP, Decimal

from django.db import migrations, models


def _hours_from_the_latest_employment(apps, schema_editor):
    """An employee without weekly hours takes those of their latest
    employment, rounded to whole hours; then the employments go, so no row is
    left that would block an employee's delete once the model is gone."""
    Employee = apps.get_model("staff", "Employee")
    Employment = apps.get_model("staff", "Employment")

    latest: dict[str, Decimal] = {}
    # Of two starting the same day, the open-ended one comes last (NULLs sort
    # last), and so wins.
    for employee_id, hours in Employment.objects.order_by(
        "valid_from", "valid_until"
    ).values_list("employee_id", "hours_per_week"):
        latest[employee_id] = hours
    employees = list(
        Employee.objects.filter(pk__in=list(latest), hours_per_week__isnull=True)
    )
    for employee in employees:
        hours = latest[employee.pk].quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        employee.hours_per_week = max(0, int(hours))
    Employee.objects.bulk_update(employees, ["hours_per_week"])
    Employment.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("staff", "0006_absencecategory_is_default_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="employee",
            name="hours_per_week",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        # The employments can't be brought back.
        migrations.RunPython(
            _hours_from_the_latest_employment, migrations.RunPython.noop
        ),
        # The model goes, the empty table stays for a release: the release
        # before reads it on every employee list (its delete check) and on an
        # employee's delete, and a rollback to it must find the table. A later
        # migration drops it.
        migrations.SeparateDatabaseAndState(
            state_operations=[migrations.DeleteModel(name="Employment")],
            database_operations=[],
        ),
    ]
