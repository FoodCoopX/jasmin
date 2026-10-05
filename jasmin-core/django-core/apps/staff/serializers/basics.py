from rest_framework import serializers

from apps.commissioning.serializers.serializers_mixin import DeletableMixin

from ..errors import (
    AbsenceCategoryNameTaken,
    EmployeeShortNameTaken,
    StaffError,
    WeeklyPlanCategoryShrinkBlocked,
    WeeklyPlanCategorySortOrderTaken,
)
from ..models import AbsenceCategory, Employee, WeeklyPlanCategory
from ..services.weekly_plan import weeks_stranded_by_shrink


def _taken_elsewhere(serializer, queryset) -> bool:
    """Whether a row other than the one being saved matches ``queryset``."""
    if serializer.instance is not None:
        queryset = queryset.exclude(pk=serializer.instance.pk)
    return queryset.exists()


class EmployeeSerializer(DeletableMixin, serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = "__all__"

    def validate_short_name_for_weekly_plan(self, value):
        # Unique across inactive employees too. An unchanged name passes: the
        # list page echoes every column back on save, so a duplicate stored
        # before this check would otherwise freeze the whole row.
        if (
            self.instance is not None
            and value == self.instance.short_name_for_weekly_plan
        ):
            return value
        if _taken_elsewhere(
            self, Employee.objects.filter(short_name_for_weekly_plan=value)
        ):
            message = "Another employee already has this weekly-plan name."
            raise EmployeeShortNameTaken(
                message,
                field="short_name_for_weekly_plan",
                details={"short_name_for_weekly_plan": [message]},
            )
        return value

    def validate_employee_number(self, value):
        # ``employee_number`` is unique but optional. A blank entry must land as
        # NULL (which Postgres treats as distinct) — otherwise a second employee
        # left blank would collide on an empty string.
        return value or None


class WeeklyPlanCategorySerializer(DeletableMixin, serializers.ModelSerializer):
    class Meta:
        model = WeeklyPlanCategory
        fields = "__all__"

    def validate_sort_order(self, value):
        # An empty order is allowed for any number of categories; a set one is
        # unique across inactive categories too. An unchanged value passes, as
        # for an employee's weekly-plan name.
        if value is None or (
            self.instance is not None and value == self.instance.sort_order
        ):
            return value
        if _taken_elsewhere(self, WeeklyPlanCategory.objects.filter(sort_order=value)):
            message = (
                "Another weekly-plan category already has this place in the order."
            )
            raise WeeklyPlanCategorySortOrderTaken(
                message, field="sort_order", details={"sort_order": [message]}
            )
        return value

    def validate_max_lines(self, value):
        # A category needs at least one grid row to be usable — ``max_lines``
        # drives ``range(category.max_lines)`` when the week grid is built, so
        # 0 or a negative count renders a category no one can fill. A stored
        # row that already carries such a count stays editable while the count
        # itself is left untouched: the list page echoes every column back on
        # save, so refusing the unchanged value would freeze the whole row.
        if value < 1 and (self.instance is None or value != self.instance.max_lines):
            message = "max_lines must be at least 1."
            # ``details`` keeps the per-field map DRF's own field errors produce,
            # so the grid keeps rendering the message against the right column.
            raise StaffError(
                message, field="max_lines", details={"max_lines": [message]}
            )

        # Lowering the count hides every row past it from the week grid, and the
        # grid replaces a whole week on each edit from the cells it was served —
        # so the first edit to such a week deletes the hidden rows. Refuse while
        # the current week or a later one still holds one. Only weeks that are
        # still editable count; past ones would make the category unshrinkable.
        if self.instance is not None and value < self.instance.max_lines:
            stranded_weeks = weeks_stranded_by_shrink(self.instance.id, value)
            if stranded_weeks:
                message = (
                    f"Weekly-plan entries still sit in rows that a max_lines of "
                    f"{value} would hide. Clear them first."
                )
                # Two shapes in one map: the ``max_lines`` list is the per-field
                # error the grid marks the cell with, ``weeks`` is structured
                # context naming the weeks in the way.
                raise WeeklyPlanCategoryShrinkBlocked(
                    message,
                    field="max_lines",
                    details={"max_lines": [message], "weeks": stranded_weeks},
                )
        return value


class AbsenceCategorySerializer(DeletableMixin, serializers.ModelSerializer):
    class Meta:
        model = AbsenceCategory
        fields = "__all__"

    def validate(self, attrs):
        attrs = super().validate(attrs)
        instance = self.instance
        year = attrs.get("year", instance.year if instance else None)
        name = attrs.get("name", instance.name if instance else None)
        # Unique per year across inactive categories too; an unchanged pair
        # passes, as for an employee's weekly-plan name.
        unchanged = instance is not None and (year, name) == (
            instance.year,
            instance.name,
        )
        if not unchanged and _taken_elsewhere(
            self, AbsenceCategory.objects.filter(year=year, name=name)
        ):
            message = "Another absence category already has this name in this year."
            raise AbsenceCategoryNameTaken(
                message, field="name", details={"name": [message]}
            )
        return attrs
