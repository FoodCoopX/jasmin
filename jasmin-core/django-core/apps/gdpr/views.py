from __future__ import annotations

import logging

from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers as drf_serializers
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.accounts.permissions import RequiresStepUp
from apps.authz.permissions import IsAdmin
from apps.shared.request_utils import auth_user, body, client_ip, request_tenant
from core.pagination import OptionalLimitOffsetPagination
from core.serializers import ErrorResponseSerializer
from core.tenant_db import connection
from core.throttling import set_throttle_scope

from .errors import (
    InvalidDeletionChannel,
    MissingRejectionReason,
    RetentionPeriodActive,
    SubjectAlreadyErased,
)
from .models import (
    OFFICE_DELETION_CHANNELS,
    DeletionLog,
    DeletionRequest,
    DeletionRequestState,
)
from .serializers import (
    AdminDecidedDeletionSerializer,
    AdminFiledDeletionSerializer,
    AdminFileDeletionRequestSerializer,
    AdminPendingDeletionListSerializer,
    AdminSubjectAccessBundleSerializer,
    DeletionLogListSerializer,
    DeletionPreviewSerializer,
    MyDeletionStatusSerializer,
    ProcessingActivitiesSerializer,
    SubjectAccessBundleSerializer,
)
from .services import (
    GDPRService,
    send_deletion_approved_email,
    send_deletion_confirmation_email,
    send_deletion_rejected_email,
)
from .services.subjects import ErasureSubject

logger = logging.getLogger("gdpr")


@extend_schema(
    tags=["gdpr"],
    summary="Subject Access Request bundle for the current user (Art. 15)",
    responses={
        200: SubjectAccessBundleSerializer,
        401: ErrorResponseSerializer,
    },
)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def gdpr_my_data_view(request: Request) -> Response:
    """Return the full Art-15 Subject Access Request bundle for the
    requesting user — every row tied to their identity (account,
    member, reseller, subscriptions, coop shares, invoices,
    email log, login history, …). See
    :class:`apps.gdpr.serializers.SubjectAccessBundleSerializer`
    for the schema; the section list lives on
    :meth:`apps.gdpr.services.GDPRService.get_subject_access_bundle`."""
    user = auth_user(request)
    bundle = GDPRService.get_subject_access_bundle(user)
    serializer = SubjectAccessBundleSerializer(bundle)
    logger.info(
        "gdpr.sar_exported user=%s tenant=%s ip=%s",
        user.email,
        connection.schema_name,
        client_ip(request),
    )
    return Response(serializer.data)


set_throttle_scope(gdpr_my_data_view, "gdpr_sar_export")


# ---------------------------------------------------------------------------
# Two-step deletion flow.
#
# - ``gdpr_request_deletion_view`` never anonymizes directly. It
#   creates a ``DeletionRequest(PENDING_EMAIL)`` and sends a 24h
#   confirmation link.
# - ``gdpr_confirm_deletion_view`` accepts the token. If the request
#   doesn't need admin approval, anonymization runs right away.
# - ``gdpr_admin_approve_deletion_view`` / ``..._reject_deletion_view``
#   are the office-side endpoints used when the admin gate is on.
# ---------------------------------------------------------------------------


@extend_schema(
    tags=["gdpr"],
    summary="Request deletion of personal data (Art. 17) — step 1 (email confirm)",
    request=None,
    responses={
        202: inline_serializer(
            name="DeletionRequestAccepted",
            fields={
                "message": drf_serializers.CharField(),
                "request_id": drf_serializers.CharField(),
                "requires_admin_approval": drf_serializers.BooleanField(),
            },
        ),
        401: ErrorResponseSerializer,
    },
)
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def gdpr_request_deletion_view(request: Request) -> Response:
    """Kick off a GDPR deletion request.

    Creates a pending ``DeletionRequest`` and emails the user a 24h
    confirmation link. NEVER anonymizes immediately — that only
    happens after the user clicks the link (and, if the tenant /
    persona requires it, the office approves).
    """
    user = auth_user(request)
    deletion_request = GDPRService.request_deletion(
        user, requested_ip=client_ip(request)
    )
    send_deletion_confirmation_email(user, deletion_request)

    logger.info(
        "gdpr.deletion_request_created user=%s request_id=%s "
        "requires_admin=%s tenant=%s ip=%s",
        user.email,
        deletion_request.pk,
        deletion_request.requires_admin_approval,
        connection.schema_name,
        client_ip(request),
    )
    return Response(
        {
            "message": (
                "We have sent a confirmation link to your email. "
                "Please open it within 24 hours to confirm the deletion."
            ),
            "request_id": str(deletion_request.pk),
            "requires_admin_approval": deletion_request.requires_admin_approval,
        },
        status=status.HTTP_202_ACCEPTED,
    )


set_throttle_scope(gdpr_request_deletion_view, "gdpr_request_deletion")


@extend_schema(
    tags=["gdpr"],
    summary="Confirm a deletion request via the emailed token — step 2",
    request=None,
    parameters=[
        OpenApiParameter(
            name="token",
            location=OpenApiParameter.PATH,
            type=str,
            description="UUID token from the deletion-confirmation email.",
        )
    ],
    responses={
        200: inline_serializer(
            name="DeletionConfirmed",
            fields={
                "message": drf_serializers.CharField(),
                "state": drf_serializers.CharField(),
            },
        ),
        404: ErrorResponseSerializer,
        409: ErrorResponseSerializer,
    },
)
@api_view(["POST"])
@permission_classes([AllowAny])
def gdpr_confirm_deletion_view(request: Request, token: str) -> Response:
    """Confirm a pending deletion request.

    ``AllowAny`` because the JWT may already be expired by the time
    the user opens their email — the token IS the proof of identity
    for this endpoint.

    On success the request moves to ``PENDING_ADMIN`` — the office
    reviews and completes the deletion. Confirmation never anonymizes
    synchronously.
    """
    deletion_request = GDPRService.confirm_deletion_token(token, ip=client_ip(request))

    message = (
        "Confirmation received. The office will review the request "
        "and complete the deletion shortly."
    )

    logger.warning(
        "gdpr.deletion_confirmed request_id=%s state=%s tenant=%s ip=%s",
        deletion_request.pk,
        deletion_request.state,
        connection.schema_name,
        client_ip(request),
    )
    return Response({"message": message, "state": str(deletion_request.state)})


set_throttle_scope(gdpr_confirm_deletion_view, "gdpr_confirm_deletion")


@extend_schema(
    tags=["gdpr"],
    summary="Admin: approve a pending deletion request",
    # No request body — confirmation is the admin's action; any
    # context they want to add goes in the existing audit log.
    request=None,
    parameters=[
        OpenApiParameter(
            name="request_id",
            location=OpenApiParameter.PATH,
            type=str,
        )
    ],
    responses={
        200: inline_serializer(
            name="DeletionApproved",
            fields={
                "message": drf_serializers.CharField(),
                "state": drf_serializers.CharField(),
            },
        ),
        401: ErrorResponseSerializer,
        403: ErrorResponseSerializer,
        404: ErrorResponseSerializer,
        409: ErrorResponseSerializer,
    },
)
@api_view(["POST"])
@permission_classes([IsAdmin, RequiresStepUp])
def gdpr_admin_approve_deletion_view(request: Request, request_id: str) -> Response:
    """Admin grants the second gate; deletion executes immediately.

    Gated by step-up auth because GDPR anonymisation is irreversible —
    a stale session left open at a café shouldn't be able to fire it
    without a fresh password re-confirmation.
    """
    admin = auth_user(request)
    deletion_request = _get_pending_request(request_id)
    deletion_request = GDPRService.admin_approve_deletion(
        deletion_request, admin_user=admin
    )
    # Email after the service transaction has committed — the helper
    # is best-effort, so a mail failure must not roll back the executed
    # deletion. Captured ``requested_email`` survives anonymisation.
    send_deletion_approved_email(deletion_request)
    logger.warning(
        "gdpr.deletion_admin_approved request_id=%s actor=%s tenant=%s ip=%s",
        deletion_request.pk,
        admin.email,
        connection.schema_name,
        client_ip(request),
    )
    return Response(
        {
            "message": "Deletion approved and executed.",
            "state": str(deletion_request.state),
        }
    )


@extend_schema(
    tags=["gdpr"],
    summary="Admin: reject a pending deletion request",
    request=inline_serializer(
        name="DeletionRejectBody",
        fields={"reason": drf_serializers.CharField()},
    ),
    parameters=[
        OpenApiParameter(
            name="request_id",
            location=OpenApiParameter.PATH,
            type=str,
        )
    ],
    responses={
        200: inline_serializer(
            name="DeletionRejected",
            fields={
                "message": drf_serializers.CharField(),
                "state": drf_serializers.CharField(),
            },
        ),
        400: ErrorResponseSerializer,
        401: ErrorResponseSerializer,
        403: ErrorResponseSerializer,
        404: ErrorResponseSerializer,
        409: ErrorResponseSerializer,
    },
)
@api_view(["POST"])
@permission_classes([IsAdmin])
def gdpr_admin_reject_deletion_view(request: Request, request_id: str) -> Response:
    """Admin denies the deletion (e.g. spotted a retention obligation,
    user phoned to cancel). The reason is required so the audit trail
    captures it."""
    deletion_request = _get_pending_request(request_id)
    raw_reason = body(request).get("reason")
    if raw_reason is not None and not isinstance(raw_reason, str):
        # A non-string reason is a hand-crafted body, and refusing it as a
        # missing reason keeps it away from ``.strip()``, which would answer
        # with a 500 instead.
        raise MissingRejectionReason("A rejection reason is required.")
    reason = (raw_reason or "").strip()
    if not reason:
        # 400 (bad input) — distinct from the 409 state errors the service
        # raises. The global handler renders the canonical {code,message}.
        raise MissingRejectionReason("A rejection reason is required.")
    deletion_request = GDPRService.admin_reject_deletion(
        deletion_request, admin_user=auth_user(request), reason=reason
    )
    # Email after the service transaction commits — best-effort.
    send_deletion_rejected_email(deletion_request, reason=reason)
    return Response(
        {
            "message": "Deletion request rejected.",
            "state": str(deletion_request.state),
        }
    )


def _get_pending_request(request_id: str) -> DeletionRequest:
    """Fetch a DeletionRequest by id, 404 if missing. Pulled out
    because both admin endpoints need it."""
    from core.errors import NotFoundError

    try:
        return DeletionRequest.objects.get(pk=request_id)
    except DeletionRequest.DoesNotExist:
        raise NotFoundError("Deletion request not found.") from None


@extend_schema(
    tags=["gdpr"],
    summary="Admin: preview what an Art-17 deletion would anonymize for a user",
    parameters=[
        OpenApiParameter(
            name="user_id",
            location=OpenApiParameter.PATH,
            type=str,
            description="Tenant JasminUser id to dry-run the deletion for.",
        )
    ],
    responses={
        200: DeletionPreviewSerializer,
        401: ErrorResponseSerializer,
        403: ErrorResponseSerializer,
        404: ErrorResponseSerializer,
    },
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def gdpr_admin_preview_deletion_view(request: Request, user_id: str) -> Response:
    """Dry-run the deletion for ``user_id``: return the subject's persona,
    the retention obligations that would currently refuse it, and the exact
    per-model field list that WOULD be scrubbed — writing nothing.

    Read-only, so ``IsAdmin`` without step-up (unlike approve, which fires the
    irreversible scrub). Lets the office answer "what happens if we delete this
    person?" before committing. See
    :meth:`apps.gdpr.services.GDPRService.preview_deletion`."""
    from django.contrib.auth import get_user_model

    from core.errors import NotFoundError

    user_model = get_user_model()

    try:
        target = user_model.objects.get(pk=user_id)
    except user_model.DoesNotExist:
        raise NotFoundError("User not found.") from None

    preview = GDPRService.preview_deletion(target)
    logger.info(
        "gdpr.deletion_previewed actor=%s target=%s persona=%s tenant=%s ip=%s",
        auth_user(request).email,
        user_id,
        preview["persona"],
        connection.schema_name,
        client_ip(request),
    )
    return Response(DeletionPreviewSerializer(preview).data)


@extend_schema(
    tags=["gdpr"],
    summary="Most recent deletion request for the current user",
    responses={
        200: MyDeletionStatusSerializer,
        401: ErrorResponseSerializer,
    },
)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def gdpr_my_deletion_status_view(request: Request) -> Response:
    """Return the user's most recent ``DeletionRequest`` so the
    profile can show "your request is pending admin review" or
    "your last request was rejected: <reason>" right above the
    Request Deletion button. Returns null fields when no request
    has ever been lodged."""
    latest = (
        DeletionRequest.objects.filter(user=auth_user(request))
        .order_by("-requested_at")
        .first()
    )
    if latest is None:
        return Response(
            {
                "state": None,
                "requested_at": None,
                "admin_confirmed_at": None,
                "admin_rejection_reason": None,
            }
        )
    return Response(
        {
            "state": str(latest.state),
            "requested_at": latest.requested_at,
            "admin_confirmed_at": latest.admin_confirmed_at,
            "admin_rejection_reason": latest.admin_rejection_reason,
        }
    )


@extend_schema(
    tags=["gdpr"],
    summary="List pending deletion requests awaiting admin approval",
    responses={
        200: AdminPendingDeletionListSerializer,
        401: ErrorResponseSerializer,
        403: ErrorResponseSerializer,
    },
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def gdpr_admin_pending_deletions_view(request: Request) -> Response:
    """List ``DeletionRequest`` rows that have passed the email gate
    and are now waiting on an admin to approve or reject.

    Each row carries a ``blockers`` list — the retention obligations
    that would refuse an Approve right now. Empty list = ready to
    approve; non-empty = admin must resolve them first (typically by
    cancelling CoopShares or settling open invoices). Computed
    per-row via ``check_retention_blocks`` so the inbox reflects the
    current state, not whatever was true at request time.

    Returned shape per row: ``id`` (the request_id the approve/reject
    endpoints take), ``requested_email`` (captured at request time —
    survives the user FK being anonymised later), ``requested_at``,
    ``email_confirmed_at``, ``current_user_email``, ``blockers``."""
    pending_requests = list(
        DeletionRequest.objects.filter(state=DeletionRequestState.PENDING_ADMIN)
        .select_related("user", "member", "reseller__contact")
        .order_by("requested_at")
    )
    # Compute retention blockers for every pending user in a constant number
    # of queries (one grouped COUNT per obligation), not ~5 per request.
    blockers_by_user = GDPRService.check_retention_blocks_bulk(
        [
            deletion_request.user
            for deletion_request in pending_requests
            if deletion_request.user is not None
        ]
    )

    def blockers(deletion_request: DeletionRequest) -> list[str]:
        if deletion_request.user_id:
            return blockers_by_user.get(deletion_request.user_id, [])
        # Filed by the office for a member or reseller without a login: rare
        # enough to check one at a time.
        subject = GDPRService.subject_of_request(deletion_request)
        if subject is None:
            return []
        return GDPRService.check_retention_blocks_for_subject(subject)

    pending = [
        {
            "id": deletion_request.id,
            "requested_email": deletion_request.requested_email,
            "subject_label": _pending_subject_label(deletion_request),
            "member_id": deletion_request.member_id,
            "reseller_id": deletion_request.reseller_id,
            "channel": deletion_request.channel,
            "requested_at": deletion_request.requested_at,
            "email_confirmed_at": deletion_request.email_confirmed_at,
            "current_user_email": (
                deletion_request.user.email if deletion_request.user_id else None
            ),
            "blockers": blockers(deletion_request),
        }
        for deletion_request in pending_requests
    ]
    return Response({"pending": pending})


def _pending_subject_label(deletion_request: DeletionRequest) -> str:
    """Who a pending request is about, as the office knows them: the member
    or reseller it was filed for, else the email it was requested from."""
    if deletion_request.member is not None:
        return str(deletion_request.member)
    if deletion_request.reseller is not None:
        return str(deletion_request.reseller)
    return deletion_request.requested_email


@extend_schema(
    tags=["gdpr"],
    summary="List decided deletion requests (rejected / executed / cancelled / expired)",
    # The view paginates by hand below, so drf-spectacular has no
    # ``pagination_class`` to read the two parameters off.
    parameters=OptionalLimitOffsetPagination.openapi_parameters(),
    responses={
        # ``OptionalLimitOffsetPagination`` declares the schema as the
        # plain row list — see ``get_paginated_response_schema`` on the
        # paginator. Runtime callers that pass ``?limit=`` still get
        # ``{count, next, previous, results}``; the frontend handles
        # the envelope.
        200: AdminDecidedDeletionSerializer(many=True),
        401: ErrorResponseSerializer,
        403: ErrorResponseSerializer,
    },
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def gdpr_admin_decided_deletions_view(request: Request) -> Response:
    """History of every deletion request that is no longer actionable —
    REJECTED, EXECUTED, CANCELLED, or EXPIRED. Most-recently-requested
    first. Paginated via the project-standard
    ``OptionalLimitOffsetPagination`` (opt-in via ``?limit=``).

    Each row carries enough to reconstruct the decision without a
    second roundtrip: who decided (``decided_by_email``), when
    (``decided_at`` = ``admin_confirmed_at`` for rejections, the
    earliest of ``executed_at`` / ``admin_confirmed_at`` for
    executions), and the office's rejection reason verbatim."""
    decided_states = [
        DeletionRequestState.REJECTED,
        DeletionRequestState.EXECUTED,
        DeletionRequestState.CANCELLED,
        DeletionRequestState.EXPIRED,
    ]
    qs = (
        DeletionRequest.objects.filter(state__in=decided_states)
        .select_related("admin_confirmed_by")
        .order_by("-requested_at")
    )

    def serialize(deletion_request: DeletionRequest) -> dict:
        # For executions ``admin_confirmed_at`` is also stamped (the
        # approve step set it), but ``executed_at`` is the more
        # meaningful "decided" moment. For rejections only
        # ``admin_confirmed_at`` is set. Cancelled/expired never go
        # through admin — ``decided_at`` is None there.
        if deletion_request.state == DeletionRequestState.EXECUTED:
            decided_at = (
                deletion_request.executed_at or deletion_request.admin_confirmed_at
            )
        elif deletion_request.state == DeletionRequestState.REJECTED:
            decided_at = deletion_request.admin_confirmed_at
        else:
            decided_at = None
        return {
            "id": deletion_request.id,
            "state": str(deletion_request.state),
            "requested_email": deletion_request.requested_email,
            "channel": deletion_request.channel,
            "requested_at": deletion_request.requested_at,
            "decided_at": decided_at,
            "decided_by_email": (
                deletion_request.admin_confirmed_by.email
                if deletion_request.admin_confirmed_by_id
                else None
            ),
            "rejection_reason": deletion_request.admin_rejection_reason or None,
        }

    paginator = OptionalLimitOffsetPagination()
    page = paginator.paginate_queryset(qs, request)
    if page is None:
        return Response([serialize(deletion_request) for deletion_request in qs])
    return paginator.get_paginated_response(
        [serialize(deletion_request) for deletion_request in page]
    )


@extend_schema(
    tags=["gdpr"],
    summary="List deletion log (admin only)",
    responses={
        200: DeletionLogListSerializer,
        401: ErrorResponseSerializer,
        403: ErrorResponseSerializer,
    },
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def gdpr_deletion_log_view(request: Request) -> Response:
    """List all GDPR deletion events (for tenant admins)."""
    logs = DeletionLog.objects.all().values(
        "id", "user_email", "deleted_at", "description"
    )
    logger.info(
        "gdpr.deletion_log_accessed actor=%s tenant=%s ip=%s",
        auth_user(request).email,
        connection.schema_name,
        client_ip(request),
    )
    return Response({"deletions": list(logs)})


@extend_schema(
    tags=["gdpr"],
    summary=("Art. 30 Record of Processing Activities (VVT) — structured " "export"),
    description=(
        "Returns the tenant's Record of Processing Activities in the "
        "Art. 30 shape: a controller block (organisation identity), "
        "the list of joint controllers / processors the codebase "
        "relies on, the per-activity records (purpose / legal basis "
        "/ data subjects / personal data / source / recipients / "
        "third-country transfers / retention / security measures / "
        "code locations), and the Art. 32 Technical & Organisational "
        "Measures.\n\n"
        "Code-level facts come from ``apps/gdpr/vvt.py`` (in-repo "
        "constants). Tenant-specific overlays (controller name, "
        "address, contact, supervisory authority, AVV-on-file flags) "
        "come from the live ``Tenant`` row + the request body of a "
        "future PUT endpoint (not yet implemented — the prose "
        "``docs/gdpr/processing-activities.md`` is still the source "
        "for the operational fill-ins). Auditor question 'show me "
        "your VVT for tenant X' is answered by GET-ting this endpoint."
    ),
    responses={
        200: ProcessingActivitiesSerializer,
        401: ErrorResponseSerializer,
        403: ErrorResponseSerializer,
    },
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def gdpr_processing_activities_view(request: Request) -> Response:
    """Art. 30 VVT export — see decorator description for the contract."""
    from django.utils import timezone

    from . import vvt

    tenant = request_tenant(request)

    # Controller block: pull every field we know the tenant has on
    # ``Tenant``. legal_form / DPO / data-protection contact / supervisory
    # authority are writable on the Tenant model (the office fills them in
    # ConfigurationGDPR) and read here; empty until the tenant fills them.
    controller = {
        "organisation_name": tenant.name,
        "legal_form": tenant.legal_form,
        "registered_address": " ".join(
            filter(
                None,
                [
                    tenant.address or "",
                    " ".join(
                        filter(
                            None,
                            [
                                tenant.zip_code or "",
                                tenant.city or "",
                            ],
                        )
                    ),
                    tenant.country or "",
                ],
            )
        ).strip(),
        "contact_email": tenant.email or "",
        "contact_phone": tenant.phone_number or "",
        "data_protection_contact": tenant.data_protection_contact,
        "dpo": tenant.dpo,
        "supervisory_authority": tenant.supervisory_authority,
    }

    payload = {
        # Versioned so a consumer (the office UI, an external audit
        # tool) can detect schema bumps without re-deriving from the
        # prose doc.
        "schema_version": "1",
        # The prose source of truth — auditors who want narrative
        # context should read this. The endpoint just gives them the
        # structured view.
        "doc_reference": "docs/gdpr/processing-activities.md",
        "generated_at": timezone.now(),
        "controller": controller,
        "processors": vvt.PROCESSORS,
        "activities": vvt.activity_dicts(),
        "technical_organisational_measures": vvt.TOMS,
    }

    logger.info(
        "gdpr.vvt_exported actor=%s tenant=%s ip=%s",
        auth_user(request).email,
        connection.schema_name,
        client_ip(request),
    )
    return Response(payload)


# ---------------------------------------------------------------------------
# Requests the office handles for a member or reseller
#
# Someone without a login, or who asks by letter, email, phone or in person,
# can't use the self-service endpoints above. The office answers them here,
# keyed by the member or reseller record.
# ---------------------------------------------------------------------------

_SUBJECT_ID_PARAMETERS = {
    "member": OpenApiParameter(
        name="member_id", location=OpenApiParameter.PATH, type=str
    ),
    "reseller": OpenApiParameter(
        name="reseller_id", location=OpenApiParameter.PATH, type=str
    ),
}


def _member_subject(member_id: str) -> ErasureSubject:
    from apps.commissioning.models import Member
    from core.errors import NotFoundError

    member = Member.objects.select_related("user").filter(pk=member_id).first()
    if member is None:
        raise NotFoundError("Member not found.")
    return ErasureSubject.of_member(member)


def _reseller_subject(reseller_id: str) -> ErasureSubject:
    from apps.commissioning.models import Reseller
    from core.errors import NotFoundError

    reseller = (
        Reseller.objects.select_related("linked_user", "contact")
        .filter(pk=reseller_id)
        .first()
    )
    if reseller is None:
        raise NotFoundError("Reseller not found.")
    return ErasureSubject.of_reseller(reseller)


def _subject_log_ref(subject: ErasureSubject) -> str:
    return " ".join(
        f"{name}={record.pk}"
        for name, record in (
            ("user", subject.user),
            ("member", subject.member),
            ("reseller", subject.reseller),
        )
        if record is not None
    )


def _erase_subject(request: Request, subject: ErasureSubject) -> Response:
    """File the subject's deletion request as the office received it, then
    approve and run it straight away.

    When retention obligations block the erasure, the request stays in the
    pending inbox and the 409 names them along with ``request_id``: the
    office approves it there once they are closed."""
    channel = body(request).get("channel")
    if not isinstance(channel, str) or channel not in {
        value for value, _label in OFFICE_DELETION_CHANNELS
    }:
        raise InvalidDeletionChannel(
            "Say how the person asked: email, letter, phone or in person."
        )
    if subject.is_erased:
        raise SubjectAlreadyErased("This person's personal data is already erased.")

    admin = auth_user(request)
    deletion_request = GDPRService.file_deletion_for_subject(
        subject, admin_user=admin, channel=channel, requested_ip=client_ip(request)
    )
    try:
        deletion_request = GDPRService.admin_approve_deletion(
            deletion_request, admin_user=admin
        )
    except RetentionPeriodActive as exc:
        raise RetentionPeriodActive(
            exc.details["reasons"], request_id=deletion_request.pk
        ) from None

    send_deletion_approved_email(deletion_request)
    logger.warning(
        "gdpr.deletion_executed_for_office request_id=%s %s channel=%s actor=%s "
        "tenant=%s ip=%s",
        deletion_request.pk,
        _subject_log_ref(subject),
        channel,
        admin.email,
        connection.schema_name,
        client_ip(request),
    )
    return Response(
        AdminFiledDeletionSerializer(
            {"request_id": deletion_request.pk, "state": str(deletion_request.state)}
        ).data
    )


def _subject_access_response(request: Request, subject: ErasureSubject) -> Response:
    bundle = GDPRService.get_subject_access_bundle_for(subject)
    logger.warning(
        "gdpr.sar_exported_by_office %s actor=%s tenant=%s ip=%s",
        _subject_log_ref(subject),
        auth_user(request).email,
        connection.schema_name,
        client_ip(request),
    )
    return Response(AdminSubjectAccessBundleSerializer(bundle).data)


_ERASE_RESPONSES = {
    200: AdminFiledDeletionSerializer,
    400: ErrorResponseSerializer,
    401: ErrorResponseSerializer,
    403: ErrorResponseSerializer,
    404: ErrorResponseSerializer,
    409: ErrorResponseSerializer,
}
_SUBJECT_ACCESS_RESPONSES = {
    200: AdminSubjectAccessBundleSerializer,
    401: ErrorResponseSerializer,
    403: ErrorResponseSerializer,
    404: ErrorResponseSerializer,
}


@extend_schema(
    tags=["gdpr"],
    summary="Admin: erase a member's personal data on their request (Art. 17)",
    request=AdminFileDeletionRequestSerializer,
    parameters=[_SUBJECT_ID_PARAMETERS["member"]],
    responses=_ERASE_RESPONSES,
)
@api_view(["POST"])
@permission_classes([IsAdmin, RequiresStepUp])
def gdpr_admin_erase_member_view(request: Request, member_id: str) -> Response:
    """Erase a member who asked the office, including one without a login.
    Step-up like the inbox approve: the erasure is irreversible."""
    return _erase_subject(request, _member_subject(member_id))


@extend_schema(
    tags=["gdpr"],
    summary="Admin: erase a reseller's personal data on their request (Art. 17)",
    request=AdminFileDeletionRequestSerializer,
    parameters=[_SUBJECT_ID_PARAMETERS["reseller"]],
    responses=_ERASE_RESPONSES,
)
@api_view(["POST"])
@permission_classes([IsAdmin, RequiresStepUp])
def gdpr_admin_erase_reseller_view(request: Request, reseller_id: str) -> Response:
    """Erase a reseller who asked the office, including one without a login."""
    return _erase_subject(request, _reseller_subject(reseller_id))


@extend_schema(
    tags=["gdpr"],
    summary="Admin: a member's Subject Access Request bundle (Art. 15)",
    parameters=[_SUBJECT_ID_PARAMETERS["member"]],
    responses=_SUBJECT_ACCESS_RESPONSES,
)
@api_view(["GET"])
@permission_classes([IsAdmin, RequiresStepUp])
def gdpr_admin_member_subject_access_view(request: Request, member_id: str) -> Response:
    """Everything stored about a member, for the office to send them.
    Step-up: it is the subject's complete personal data in one response."""
    return _subject_access_response(request, _member_subject(member_id))


@extend_schema(
    tags=["gdpr"],
    summary="Admin: a reseller's Subject Access Request bundle (Art. 15)",
    parameters=[_SUBJECT_ID_PARAMETERS["reseller"]],
    responses=_SUBJECT_ACCESS_RESPONSES,
)
@api_view(["GET"])
@permission_classes([IsAdmin, RequiresStepUp])
def gdpr_admin_reseller_subject_access_view(
    request: Request, reseller_id: str
) -> Response:
    """Everything stored about a reseller, for the office to send them."""
    return _subject_access_response(request, _reseller_subject(reseller_id))
