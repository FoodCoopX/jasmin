"""Box-combination COLUMN serializers, shared across the packing-boxes matrix
(``shares_serializer``) and the delivery-stations tour overview
(``delivery_serializer``).

They live in their own module to break the ``shares_serializer`` <->
``delivery_serializer`` import cycle: ``shares_serializer`` already imports
``CapacityWeekEntrySerializer`` from ``delivery_serializer``, so the overview
response serializer can't import the column serializer straight back from
``shares_serializer`` without a partial-initialisation ImportError. Both import
from here instead.
"""

from rest_framework import serializers


class PackingBoxesMatrixAddOnSerializer(serializers.Serializer):
    """One add-on ("Zusatz") packed into a box combination."""

    variation_id = serializers.CharField()
    size = serializers.CharField(allow_blank=True)
    sort_order = serializers.IntegerField()
    share_type_id = serializers.CharField()
    share_type_short_name = serializers.CharField(allow_blank=True)
    share_type_sort_index = serializers.IntegerField()
    is_packed_bulk = serializers.BooleanField(
        help_text="The variation's own setting, which decides only in MIXED "
        "packing mode."
    )


class PackingBoxesMatrixColumnSerializer(serializers.Serializer):
    """One box combination — a base box plus its packed-in add-ons — with the
    number of such boxes in the current scope."""

    key = serializers.CharField()
    base_variation_id = serializers.CharField(allow_null=True)
    base_size = serializers.CharField(allow_blank=True)
    base_sort_order = serializers.IntegerField()
    base_share_type_id = serializers.CharField(allow_null=True)
    base_share_type_name = serializers.CharField(allow_blank=True)
    base_share_type_short_name = serializers.CharField(allow_blank=True)
    base_share_type_sort_index = serializers.IntegerField()
    base_is_packed_bulk = serializers.BooleanField(
        help_text="The base variation's own setting, which decides only in MIXED "
        "packing mode; false for a combination without a base."
    )
    add_ons = PackingBoxesMatrixAddOnSerializer(many=True)
    count = serializers.IntegerField()
