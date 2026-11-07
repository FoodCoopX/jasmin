"""Response serializers of the station contents, the members' notice at a
delivery station."""

from rest_framework import serializers

from ..models import ShareArticle


class StationContentsItemSerializer(serializers.Serializer):
    """One article of a share, at the amount one share holds."""

    id = serializers.CharField()
    share_article_id = serializers.CharField()
    share_article_name = serializers.CharField()
    amount = serializers.DecimalField(max_digits=5, decimal_places=3)
    unit = serializers.CharField(allow_blank=True)
    size = serializers.CharField(allow_blank=True)
    note = serializers.CharField(allow_blank=True)
    seller_name_for_member_pages = serializers.CharField(
        allow_blank=True,
        help_text="The name the article's seller shows members; blank without one.",
    )
    organic_status = serializers.ChoiceField(choices=ShareArticle.OrganicStatus.choices)


class StationContentsShareSerializer(serializers.Serializer):
    """One physical share type variation collected at the station."""

    variation_id = serializers.CharField()
    size = serializers.CharField(allow_blank=True)
    share_type_id = serializers.CharField()
    share_type_name = serializers.CharField(allow_blank=True)
    is_packed_bulk = serializers.BooleanField(
        help_text=(
            "The variation's own setting, which decides only in MIXED packing "
            "mode: in BULK mode every share is loose, in BOXES mode none is."
        )
    )
    items = StationContentsItemSerializer(many=True)


class StationContentsSerializer(serializers.Serializer):
    shares = StationContentsShareSerializer(many=True)
