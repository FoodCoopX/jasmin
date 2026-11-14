from rest_framework import serializers

from ..errors import StaffError
from ..services.weekly_plan import WEEKDAYS
from .basics import HrSystemSyncResultSerializer

# --------------------------------------------------------------------------- #
# Request payloads
# --------------------------------------------------------------------------- #


class AbsenceWeekReplaceSerializer(serializers.Serializer):
    """One employee's absences in one ISO week. ``days`` maps a weekday
    (``"0"`` = Monday .. ``"6"``) to an absence category id; a day left out or
    null has no absence."""

    year = serializers.IntegerField(min_value=2000, max_value=2100)
    week = serializers.IntegerField(min_value=1, max_value=53)
    employee_id = serializers.CharField()
    days = serializers.DictField(child=serializers.CharField(allow_null=True))

    def validate_days(self, value):
        weekdays = {str(day) for day in WEEKDAYS}
        unknown = sorted(set(value) - weekdays)
        if unknown:
            message = f"Not a weekday: {', '.join(unknown)}. Weekdays are 0 to 6."
            raise StaffError(message, field="days", details={"days": [message]})
        return {int(day): category_id for day, category_id in value.items()}


# --------------------------------------------------------------------------- #
# Responses
# --------------------------------------------------------------------------- #


class AbsenceCategoryOptionSerializer(serializers.Serializer):
    id = serializers.CharField()
    name = serializers.CharField()
    is_active = serializers.BooleanField()
    is_default = serializers.BooleanField()


class AbsenceWeekEmployeeSerializer(serializers.Serializer):
    id = serializers.CharField()
    short_name_for_weekly_plan = serializers.CharField()
    is_active = serializers.BooleanField()
    comes_from_hr_system = serializers.BooleanField()
    # ``{"0": category_id|null, ... "6": category_id|null}`` — one entry per
    # weekday.
    days = serializers.DictField(child=serializers.CharField(allow_null=True))


class AbsenceWeekSerializer(serializers.Serializer):
    """The absences of one ISO week, with every category, inactive ones
    included, so a day keeps showing a category since switched off."""

    year = serializers.IntegerField()
    week = serializers.IntegerField()
    categories = AbsenceCategoryOptionSerializer(many=True)
    employees = AbsenceWeekEmployeeSerializer(many=True)


class HrSystemAbsenceSyncResultSerializer(serializers.Serializer):
    created = serializers.IntegerField()
    updated = serializers.IntegerField()
    deleted = serializers.IntegerField()
    conflicts = serializers.IntegerField(
        help_text="Shifts planned from this week on that fall on an absence."
    )


class AbsenceSyncResultSerializer(serializers.Serializer):
    """What a sync of the absences changed, and of the employees before them."""

    employees = HrSystemSyncResultSerializer()
    absences = HrSystemAbsenceSyncResultSerializer()
