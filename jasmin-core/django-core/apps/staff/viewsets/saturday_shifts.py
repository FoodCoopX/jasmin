from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from apps.authz.permissions import IsOffice, IsStaff, RolePermissionsMixin
from core.serializers import ErrorResponseSerializer

from ..query_params import validate_query_params
from ..schemas import get_year_parameter
from ..serializers import SaturdayShiftSetSerializer, SaturdayShiftYearSerializer
from ..services import build_saturday_year, set_saturday_shift


class SaturdayShiftViewSet(RolePermissionsMixin, viewsets.ViewSet):
    """The Saturday shifts of one year: an employee per row, an ISO week per
    cell. A shift is the employee's Saturday row in the weekly plan."""

    read_permission = IsStaff
    write_permission = IsOffice
    read_actions = frozenset({"year"})

    @extend_schema(
        parameters=[get_year_parameter()],
        responses=SaturdayShiftYearSerializer,
    )
    @action(detail=False, methods=["get"], url_path="year")
    def year(self, request: Request) -> Response:
        params = validate_query_params(request, required=["year"])
        return Response(
            SaturdayShiftYearSerializer(build_saturday_year(params["year"])).data
        )

    @extend_schema(
        request=SaturdayShiftSetSerializer,
        responses={
            200: SaturdayShiftYearSerializer,
            400: ErrorResponseSerializer,
            404: ErrorResponseSerializer,
            409: ErrorResponseSerializer,
        },
    )
    @year.mapping.post
    def set_shift(self, request: Request) -> Response:
        serializer = SaturdayShiftSetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        set_saturday_shift(
            data["year"], data["week"], data["employee_id"], on_duty=data["on_duty"]
        )
        return Response(
            SaturdayShiftYearSerializer(build_saturday_year(data["year"])).data
        )
