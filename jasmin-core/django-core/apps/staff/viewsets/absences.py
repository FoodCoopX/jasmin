from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from apps.authz.permissions import IsOffice, IsStaff, RolePermissionsMixin
from apps.shared.request_utils import request_tenant
from core.serializers import ErrorResponseSerializer

from ..query_params import validate_query_params
from ..schemas import get_week_parameter, get_year_parameter
from ..serializers import (
    AbsenceSyncResultSerializer,
    AbsenceWeekReplaceSerializer,
    AbsenceWeekSerializer,
    HrSystemSyncRequestSerializer,
)
from ..services import (
    build_absence_week,
    replace_employee_week,
    sync_absences_from_hr_system,
)


class AbsenceViewSet(RolePermissionsMixin, viewsets.ViewSet):
    """The absences of one ISO week: an employee per row, a weekday per cell.
    The office enters those of the employees entered in Jasmin; those of the
    HR system's employees come from the HR system."""

    read_permission = IsStaff
    write_permission = IsOffice
    read_actions = frozenset({"week"})

    def get_throttles(self):
        # A sync calls the HR system with its admin's token.
        self.throttle_scope = (
            "hr_system_sync" if self.action == "sync_from_hr_system" else None
        )
        return super().get_throttles()

    @extend_schema(
        parameters=[get_year_parameter(), get_week_parameter()],
        responses=AbsenceWeekSerializer,
    )
    @action(detail=False, methods=["get"], url_path="week")
    def week(self, request: Request) -> Response:
        params = validate_query_params(request, required=["year", "week"])
        week = build_absence_week(params["year"], params["week"])
        return Response(AbsenceWeekSerializer(week).data)

    @extend_schema(
        request=AbsenceWeekReplaceSerializer,
        responses={
            200: AbsenceWeekSerializer,
            400: ErrorResponseSerializer,
            404: ErrorResponseSerializer,
            409: ErrorResponseSerializer,
        },
    )
    @week.mapping.post
    def replace_week(self, request: Request) -> Response:
        serializer = AbsenceWeekReplaceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        replace_employee_week(
            data["year"],
            data["week"],
            data["employee_id"],
            data["days"],
            uses_hr_system=request_tenant(request).uses_hr_system,
        )
        week = build_absence_week(data["year"], data["week"])
        return Response(AbsenceWeekSerializer(week).data)

    @extend_schema(
        request=HrSystemSyncRequestSerializer,
        responses={
            200: AbsenceSyncResultSerializer,
            409: ErrorResponseSerializer,
            502: ErrorResponseSerializer,
        },
    )
    @action(detail=False, methods=["post"], url_path="sync_from_hr_system")
    def sync_from_hr_system(self, request: Request) -> Response:
        options = HrSystemSyncRequestSerializer(data=request.data)
        options.is_valid(raise_exception=True)
        employees, absences = sync_absences_from_hr_system(
            request_tenant(request),
            confirm_deactivations=options.validated_data["confirm_deactivations"],
        )
        return Response(
            AbsenceSyncResultSerializer(
                {"employees": employees, "absences": absences}
            ).data
        )
