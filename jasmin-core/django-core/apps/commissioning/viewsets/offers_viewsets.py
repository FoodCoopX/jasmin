"""The week's offers of an offer group: edited by the office, ordered from by
resellers."""

from __future__ import annotations

from typing import Any

from django.db.models import F, QuerySet
from django.db.models.expressions import Exists, OuterRef
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from apps.authz.permissions import (
    IsOffice,
    IsStaff,
    IsStaffOrCustomer,
    RolePermissionsMixin,
)
from core.errors import ForbiddenError
from core.pagination import OptionalLimitOffsetPagination

from ..errors import ResellerNotFound
from ..models import Forecast, Offer, Reseller
from ..schemas import (
    get_delivery_week_parameter,
    get_offer_group_parameter,
    get_reseller_parameter,
    get_year_parameter,
)
from ..scoping import (
    is_privileged,
    own_reseller_id,
    scope_to_finalized,
    scope_to_offer_group,
)
from ..serializers import OfferSerializer
from ..services import OfferService
from ..services.offer_deletion import annotate_offer_deletability, delete_offer
from ..utils.lookup import get_or_404
from ..utils.query_params import validate_query_params


class OfferViewSet(RolePermissionsMixin, viewsets.ModelViewSet):
    read_permission = IsStaffOrCustomer
    write_permission = IsOffice
    serializer_class = OfferSerializer
    # An offer group's week can hold hundreds of offers, each annotated with
    # correlated order-volume subqueries. ``?limit=`` bounds the payload; a
    # caller that sends neither limit nor offset still gets the plain array.
    pagination_class = OptionalLimitOffsetPagination

    @extend_schema(
        parameters=[
            get_year_parameter(required=True),
            get_delivery_week_parameter(required=True),
            get_offer_group_parameter(
                description=(
                    "Offer group ID (Jasmin ID format). Ignored whenever the "
                    "scope resolves from a reseller: that reseller's own offer "
                    "group wins. A caller without an office/admin/management "
                    "role is always scoped to their own linked reseller, so "
                    "for them this parameter never applies, sent or not."
                ),
            ),
            get_reseller_parameter(
                description=(
                    "Reseller ID (Jasmin ID format). Also scopes the "
                    "amount_ordered totals to this reseller. Its own offer "
                    "group wins over an offer_group sent alongside it, and a "
                    "reseller with no offer group matches no offer. A caller "
                    "without an office/admin/management role is forced to "
                    "their own linked reseller whether or not this is sent."
                ),
            ),
        ],
    )
    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        return super().list(request, *args, **kwargs)

    def get_queryset(self) -> QuerySet[Offer]:
        # Schema generation calls this with no request behind it, where the
        # required week scope below would raise.
        if getattr(self, "swagger_fake_view", False):
            return Offer.objects.none()

        queryset: QuerySet[Offer] = Offer.objects.all()

        list_route = self.action == "list"
        params = validate_query_params(
            self.request,
            # The week scope is required on the list route, as the schema has
            # always declared it: without it every offer of every year is read
            # and annotated. A detail route (retrieve/update/destroy) reaches
            # this method with no query string at all, so there the two stay
            # optional.
            required=["year", "delivery_week"] if list_route else [],
            optional=(
                ["offer_group", "reseller"]
                if list_route
                else ["year", "delivery_week", "offer_group", "reseller"]
            ),
        )
        year = params["year"]
        delivery_week = params["delivery_week"]
        offer_group = params["offer_group"]
        reseller_id = params["reseller"]

        # Object scoping (IDOR): the ``amount_ordered`` annotation exposes a
        # reseller's per-article order volume. A non-privileged caller (customer)
        # may only see their OWN reseller's totals — reject a ?reseller= pointing
        # at a peer in the same offer_group, and force their own reseller when the
        # param is omitted (else the annotation sums the whole group's orders).
        # Mirrors OrderContentViewSet.list; privileged staff bypass.
        if not is_privileged(self.request, privileged_roles=IsStaff.required_roles):
            own_id = own_reseller_id(self.request)
            if own_id is None:
                return Offer.objects.none()
            if reseller_id and str(reseller_id) != own_id:
                raise ForbiddenError("Cannot view offers for another reseller.")
            reseller_id = own_id

        if year is not None:
            queryset = queryset.filter(year=year)
        if delivery_week is not None:
            queryset = queryset.filter(delivery_week=delivery_week)

        if reseller_id is not None:
            reseller = get_or_404(
                Reseller, reseller_id, "Reseller", error_cls=ResellerNotFound
            )
            # A reseller only ever gets its own group's offers, so its group is
            # the effective one: it takes precedence over an ``offer_group``
            # the caller sent alongside it, and a reseller with no group at all
            # matches no offer. Resolving it into ``offer_group`` lets the
            # single filter below do the work.
            if reseller.offer_group_id is None:
                return Offer.objects.none()
            offer_group = reseller.offer_group_id

        if offer_group is not None:
            queryset = queryset.filter(offer_group=offer_group)

        # Same set as the ``is_privileged`` guard above, or that guard empties
        # the result before this scope is applied.
        queryset = scope_to_offer_group(
            queryset,
            self.request,
            path="offer_group_id",
            privileged_roles=IsStaff.required_roles,
        )
        queryset = scope_to_finalized(
            queryset,
            self.request,
            path="is_finalized",
            privileged_roles=IsStaff.required_roles,
        )

        queryset = OfferService.annotate_offers_with_ordered_amounts(
            queryset=queryset,
            year=year,
            delivery_week=delivery_week,
            reseller=reseller_id,
        )

        queryset = annotate_offer_deletability(queryset)
        queryset = queryset.annotate(
            share_article_name=F("share_article__name"),
            forecast_exists=Exists(
                Forecast.objects.filter(
                    year=OuterRef("year"),
                    delivery_week=OuterRef("delivery_week"),
                    share_article=OuterRef("share_article"),
                    unit=OuterRef("unit"),
                    size=OuterRef("size"),
                )
            ),
        )
        # ``OfferSerializer.organic_status`` reads ``share_article.organic_status``
        # per row — select_related the FK so the list isn't N+1 (the
        # ``share_article_name`` annotation only pulls the name column via JOIN,
        # it does not populate the related instance). Locked by
        # ``test_query_count_locks.test_offers_list_is_scale_invariant``.
        return queryset.select_related("share_article").order_by("share_article_name")

    def destroy(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        """Delete an offer, finalized or not, while nobody can have acted on it;
        refused with offer.already_ordered or offer.already_sent (409)
        otherwise."""
        delete_offer(self.get_object())
        return Response(status=status.HTTP_204_NO_CONTENT)
