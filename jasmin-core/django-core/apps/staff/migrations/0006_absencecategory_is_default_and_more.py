from django.db import migrations, models
from django.utils import timezone

DEFAULT_NAME = "Abwesenheit"


def _merge_years_and_seed_the_default(apps, schema_editor):
    """Absence categories hold for every year now. Categories of the same name
    from several years become one — the active one, else the latest — and
    their absences move to it. Then the default category is made, or a
    category already named so becomes it. Idempotent."""
    AbsenceCategory = apps.get_model("staff", "AbsenceCategory")
    Absence = apps.get_model("staff", "Absence")

    by_name: dict[str, list] = {}
    for category in AbsenceCategory.objects.order_by(
        "-is_active", models.F("year").desc(nulls_last=True), "id"
    ):
        by_name.setdefault(category.name, []).append(category)
    for kept, *merged in by_name.values():
        if merged:
            merged_ids = [category.id for category in merged]
            Absence.objects.filter(absence_category_id__in=merged_ids).update(
                absence_category_id=kept.id
            )
            AbsenceCategory.objects.filter(id__in=merged_ids).delete()

    if AbsenceCategory.objects.filter(is_default=True).exists():
        return
    named = AbsenceCategory.objects.filter(name=DEFAULT_NAME).first()
    if named is None:
        AbsenceCategory.objects.create(name=DEFAULT_NAME, is_default=True)
    else:
        named.is_default = True
        named.is_active = True
        named.save(update_fields=["is_default", "is_active"])


def _give_each_category_a_year(apps, schema_editor):
    """The reverse: a category without a year gets the current one, so the
    column can be required again. The merged categories stay merged."""
    AbsenceCategory = apps.get_model("staff", "AbsenceCategory")
    AbsenceCategory.objects.filter(year__isnull=True).update(
        year=timezone.localdate().year
    )


class Migration(migrations.Migration):

    dependencies = [
        ("staff", "0005_employee_comes_from_hr_system_employee_hr_system_id"),
    ]

    operations = [
        migrations.AlterField(
            model_name="absencecategory",
            name="year",
            field=models.PositiveSmallIntegerField(
                blank=True, editable=False, null=True
            ),
        ),
        migrations.AlterModelOptions(
            name="absencecategory",
            options={"ordering": ["name"], "verbose_name_plural": "absence categories"},
        ),
        migrations.AddField(
            model_name="absencecategory",
            name="is_default",
            field=models.BooleanField(db_default=False, default=False, editable=False),
        ),
        # Before the data step: a category the merge deletes leaves a deferred
        # foreign-key check pending on the table, and Postgres builds no index
        # on a table with pending trigger events.
        migrations.AddConstraint(
            model_name="absencecategory",
            constraint=models.UniqueConstraint(
                condition=models.Q(("is_default", True)),
                fields=("is_default",),
                name="absencecategory_single_default",
            ),
        ),
        migrations.RunPython(
            _merge_years_and_seed_the_default, _give_each_category_a_year
        ),
    ]
