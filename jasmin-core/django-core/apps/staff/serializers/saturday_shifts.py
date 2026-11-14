from rest_framework import serializers

# --------------------------------------------------------------------------- #
# Request payloads
# --------------------------------------------------------------------------- #


class SaturdayShiftSetSerializer(serializers.Serializer):
    """One employee's Saturday shift in one ISO week, set or taken away."""

    year = serializers.IntegerField(min_value=2000, max_value=2100)
    week = serializers.IntegerField(min_value=1, max_value=53)
    employee_id = serializers.CharField()
    on_duty = serializers.BooleanField()


# --------------------------------------------------------------------------- #
# Responses
# --------------------------------------------------------------------------- #


class SaturdayShiftEmployeeSerializer(serializers.Serializer):
    id = serializers.CharField()
    short_name_for_weekly_plan = serializers.CharField()
    is_active = serializers.BooleanField()
    weeks = serializers.ListField(
        child=serializers.IntegerField(),
        help_text="The ISO weeks whose Saturday the employee works.",
    )
    absent_weeks = serializers.ListField(
        child=serializers.IntegerField(),
        help_text="The ISO weeks whose Saturday the employee is absent on.",
    )


class SaturdayShiftYearSerializer(serializers.Serializer):
    """The Saturday shifts of one year: those of the active employees, and of
    inactive ones who still have one."""

    year = serializers.IntegerField()
    weeks = serializers.IntegerField(help_text="The year's ISO weeks, 52 or 53.")
    employees = SaturdayShiftEmployeeSerializer(many=True)
