from rest_framework import serializers


class MemberGrowthStatisticSerializer(serializers.Serializer):
    """Admitted members per period: entries, exits and the count at its end."""

    period = serializers.DateField(help_text="Period date (start of month/week/year)")
    new_members = serializers.IntegerField(
        help_text="Confirmed members whose entry date falls in this period"
    )
    exited_members = serializers.IntegerField(
        help_text="Confirmed members whose exit date falls in this period"
    )
    total_members = serializers.IntegerField(
        help_text="Members at the end of this period: every entry up to it minus "
        "every exit up to it, including those before the filtered window"
    )


class MemberDashboardStatisticsSerializer(serializers.Serializer):
    """Snapshot ("today") of member + cooperative-share statistics."""

    total_members = serializers.IntegerField()
    trial_members = serializers.IntegerField()
    confirmed_members = serializers.IntegerField()
    pending_members = serializers.IntegerField()
    cancelled_members = serializers.IntegerField()
    average_age = serializers.FloatField(
        help_text="Average age (years) of current members with a known birth date"
    )
    total_coop_shares = serializers.FloatField()
    confirmed_coop_shares = serializers.FloatField()
    pending_coop_shares = serializers.FloatField()
    paid_coop_shares = serializers.FloatField()
    unpaid_coop_shares = serializers.FloatField()
    payback_due_coop_shares = serializers.FloatField(
        help_text="Shares owed back to cancelled members, not yet paid back"
    )
    # What each figure above is worth, every share at the value it was
    # subscribed at (a 2dp money string).
    total_coop_shares_value = serializers.DecimalField(max_digits=14, decimal_places=2)
    confirmed_coop_shares_value = serializers.DecimalField(
        max_digits=14, decimal_places=2
    )
    pending_coop_shares_value = serializers.DecimalField(
        max_digits=14, decimal_places=2
    )
    paid_coop_shares_value = serializers.DecimalField(max_digits=14, decimal_places=2)
    unpaid_coop_shares_value = serializers.DecimalField(max_digits=14, decimal_places=2)
    payback_due_coop_shares_value = serializers.DecimalField(
        max_digits=14, decimal_places=2
    )


class PurchaseCostByWeekSerializer(serializers.Serializer):
    """One (ISO week, purchase cost) point for the purchase-statistics bar chart.

    ``amount`` is the total money spent buying in purchased ("Zukauf") share
    articles that week — a 2dp money STRING (full precision survives the wire),
    not a JSON number, mirroring the money-on-the-wire convention.
    """

    year = serializers.IntegerField(help_text="ISO year of the delivery week.")
    week = serializers.IntegerField(help_text="ISO delivery week (1–53).")
    amount = serializers.CharField(
        help_text="Total purchase cost for the week, 2dp string."
    )


class ShareWeightsByWeekSerializer(serializers.Serializer):
    """One (ISO week, share type variation) point for the weight statistics:
    the average weight of the variation's shares weighed that week against its
    target weight, both in kg as 3dp strings. ``average_weight`` is null for a
    week in which no share of the variation was weighed, ``target_weight`` for
    a variation without one."""

    year = serializers.IntegerField()
    week = serializers.IntegerField()
    share_type_variation = serializers.CharField()
    share_type = serializers.CharField()
    share_type_name = serializers.CharField()
    share_type_rank = serializers.IntegerField(
        help_text="The share type's place among the response's share types: "
        "base share types first, then additional ones, each by its first "
        "variation's sort_order and size."
    )
    size = serializers.CharField()
    variation_rank = serializers.IntegerField(
        help_text="The variation's place among the response's variations: by "
        "share type rank, then sort_order, then size."
    )
    target_weight = serializers.DecimalField(
        max_digits=5, decimal_places=3, allow_null=True
    )
    weighed_shares = serializers.IntegerField(
        help_text="How many of the variation's shares (one per delivery day) "
        "were weighed that week."
    )
    average_weight = serializers.DecimalField(
        max_digits=10, decimal_places=3, allow_null=True
    )


class ShareWeightsSummarySerializer(serializers.Serializer):
    """One share type size's weighed boxes over a date range, for the weight
    statistics; weights in kg as 3dp strings, each weight taken of a share one
    box. A size takes in the variations succeeding each other in it, and names
    its first one, as the weekly points of the same range do.
    ``average_weight`` is null where none of the size's boxes was weighed,
    ``standard_deviation`` below two weighed boxes, ``target_weight`` where the
    size's latest-starting variation has none, and
    ``total_difference_from_target`` where no weighed box has a target."""

    share_type_variation = serializers.CharField()
    share_type_name = serializers.CharField()
    size = serializers.CharField()
    target_weight = serializers.DecimalField(
        max_digits=5,
        decimal_places=3,
        allow_null=True,
        help_text="The target of the size's variation that starts latest.",
    )
    weighed_boxes = serializers.IntegerField()
    average_weight = serializers.DecimalField(
        max_digits=10, decimal_places=3, allow_null=True
    )
    standard_deviation = serializers.DecimalField(
        max_digits=10,
        decimal_places=3,
        allow_null=True,
        help_text="The sample standard deviation between the weighed boxes.",
    )
    total_difference_from_target = serializers.DecimalField(
        max_digits=15,
        decimal_places=3,
        allow_null=True,
        help_text="The weighed boxes' differences from their own variation's "
        "target, summed; negative where they weighed too little.",
    )
