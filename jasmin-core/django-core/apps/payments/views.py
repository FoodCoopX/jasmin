from __future__ import annotations

import logging

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import RequiresStepUp
from apps.authz.permissions import IsMember
from apps.commissioning.errors import MemberProfileNotLinked
from apps.commissioning.models import Member
from apps.shared.request_utils import client_ip
from core.serializers import ErrorResponseSerializer
from core.tenant_db import connection

from .serializers import BillingProfileMemberSerializer, MySepaMandateSerializer
from .services import BillingProfileService, SepaMandateSignature

logger = logging.getLogger(__name__)


class MySepaMandateView(APIView):
    """The authenticated member signs a SEPA mandate for their own account.

    The billing-profile viewset is the office's tool: its writes are
    office-only and take the member, the reference and the signature date from
    the caller. Self-service gets this endpoint instead. The member is the one
    linked to the session (``request.user.member_profile``), so there is no
    addressable member and no way to reach another member's mandate, and the
    rest of what makes the mandate authoritative is set server-side by
    ``BillingProfileService.sign_member_mandate``.

    Writing an IBAN is step-up gated, like every other bank-account write.
    """

    permission_classes = [IsMember, RequiresStepUp]

    @extend_schema(
        tags=["Payments — Billing profiles"],
        summary="Sign the member's own SEPA mandate (self-service)",
        description=(
            "Creates the authenticated member's billing profile with a SEPA "
            "mandate, or re-signs a mandate that has never been used for a "
            "collection. The signature date is today and the mandate reference "
            "is minted server-side; re-signing keeps the reference only while "
            "the account stays the same. The consent is recorded against "
            "`consent_document_id`, which must be the SEPA mandate text in "
            "force today, and replaces the member's earlier SEPA consent. "
            "Refused with 409 when the mandate has already been used for a "
            "collection (a different account needs a new mandate from the "
            "office) or when the office has deactivated the profile. Responds "
            "201 when the profile was created, 200 when it existed. Step-up "
            "authentication is required."
        ),
        request=MySepaMandateSerializer,
        responses={
            200: BillingProfileMemberSerializer,
            201: BillingProfileMemberSerializer,
            400: ErrorResponseSerializer,
            401: ErrorResponseSerializer,
            403: ErrorResponseSerializer,
            404: ErrorResponseSerializer,
            409: ErrorResponseSerializer,
        },
    )
    def post(self, request: Request) -> Response:
        member: Member | None = getattr(request.user, "member_profile", None)
        if member is None:
            raise MemberProfileNotLinked("No member profile linked to this user.")

        serializer = MySepaMandateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        profile, created = BillingProfileService.sign_member_mandate(
            member,
            SepaMandateSignature(
                iban=data["iban"],
                account_holder=data["account_holder"],
                consent_document_id=data["consent_document_id"],
            ),
            ip_address=client_ip(request) or None,
            user_agent=request.META.get("HTTP_USER_AGENT", ""),
        )
        logger.info(
            "payments.billing_profile.member_mandate_signed member=%s created=%s "
            "tenant=%s",
            member.id,
            created,
            connection.schema_name,
        )
        return Response(
            BillingProfileMemberSerializer(profile, context={"request": request}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
