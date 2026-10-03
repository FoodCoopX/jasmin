"""Tests for the Art-17 deletion PREVIEW (dry-run).

Covers persona detection (Member / Customer / Staff), the ``preview_deletion``
payload shape + fidelity to ``FIELD_CLASSIFICATION`` and the retention check,
the preview of a member or reseller without a login, the "writes nothing"
guarantee, and the two admin-only endpoints — by user and by pending request.
"""

from __future__ import annotations

import datetime

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.commissioning.models import CoopShareTransfer
from apps.commissioning.tests.factories import (
    CoopShareFactory,
    JasminUserFactory,
    MemberFactory,
    ResellerFactory,
)
from apps.gdpr.models import DeletionRequestState
from apps.gdpr.services import GDPRService, Persona
from apps.gdpr.services.subjects import ErasureSubject


def _models_by_label(preview: dict) -> dict[str, dict]:
    return {m["model"]: m for m in preview["models"]}


@pytest.mark.django_db
class TestDetectPersona:
    def test_member_is_member_persona(self, tenant):
        user = JasminUserFactory(roles=["member"])
        MemberFactory(user=user)
        assert GDPRService.detect_persona(user) is Persona.MEMBER

    def test_reseller_only_is_customer_persona(self, tenant):
        user = JasminUserFactory(roles=["member"])
        ResellerFactory(linked_user=user)
        assert GDPRService.detect_persona(user) is Persona.CUSTOMER

    def test_no_member_no_reseller_is_staff_persona(self, tenant):
        user = JasminUserFactory(roles=["office"])
        assert GDPRService.detect_persona(user) is Persona.STAFF

    def test_member_who_is_also_reseller_is_member_persona(self, tenant):
        # The stricter registry obligation governs — MEMBER wins the label.
        user = JasminUserFactory(roles=["member"])
        MemberFactory(user=user)
        ResellerFactory(linked_user=user)
        assert GDPRService.detect_persona(user) is Persona.MEMBER


@pytest.mark.django_db
class TestPreviewDeletionShape:
    def test_staff_preview_lists_jasmin_user_fields_and_can_delete(self, tenant):
        user = JasminUserFactory(roles=["office"], email="clerk@example.com")

        preview = GDPRService.preview_deletion(user)

        assert preview["persona"] == "staff"
        assert preview["has_member"] is False
        assert preview["has_reseller"] is False
        assert preview["can_anonymize_now"] is True
        assert preview["retention_blocks"] == []

        models = _models_by_label(preview)
        assert "accounts.JasminUser" in models
        scrubbed = {
            f["field"] for f in models["accounts.JasminUser"]["scrubbed_fields"]
        }
        assert {"email", "first_name", "last_name"} <= scrubbed
        assert preview["field_count"] >= len(scrubbed)
        assert preview["model_count"] == len(preview["models"])

    def test_member_preview_includes_member_model(self, tenant):
        user = JasminUserFactory(roles=["member"])
        MemberFactory(user=user)

        preview = GDPRService.preview_deletion(user)

        assert preview["persona"] == "member"
        assert preview["has_member"] is True
        models = _models_by_label(preview)
        assert "commissioning.Member" in models
        # The Member scrub list carries a known TOMBSTONE + a PII_IMMEDIATE.
        member_fields = {
            f["field"]: f["action"]
            for f in models["commissioning.Member"]["scrubbed_fields"]
        }
        assert member_fields.get("first_name") == "tombstone"
        assert member_fields.get("email") == "pii_immediate"

    def test_member_preview_counts_transfer_notes_on_both_sides(self, tenant):
        user = JasminUserFactory(roles=["member"])
        member = MemberFactory(user=user)
        other = MemberFactory()
        transfer = CoopShareTransfer.objects.create(
            from_member=member,
            to_member=other,
            amount_of_coop_shares=1,
            transfer_date=datetime.date(2026, 3, 2),
            note="sold",
        )
        CoopShareFactory(
            member=member, amount_of_coop_shares=-1, transfer=transfer, note="to other"
        )
        CoopShareFactory(
            member=other, amount_of_coop_shares=1, transfer=transfer, note="from member"
        )

        entry = _models_by_label(GDPRService.preview_deletion(user))[
            "commissioning.CoopShareTransfer"
        ]

        assert entry["row_count"] == 3
        assert [field["field"] for field in entry["scrubbed_fields"]] == ["note"]

    def test_customer_preview_includes_reseller_model(self, tenant):
        user = JasminUserFactory(roles=["member"])
        ResellerFactory(linked_user=user)

        preview = GDPRService.preview_deletion(user)

        assert preview["persona"] == "customer"
        assert preview["has_reseller"] is True
        assert "commissioning.Reseller" in _models_by_label(preview)

    def test_side_channels_present(self, tenant):
        user = JasminUserFactory(roles=["office"])
        preview = GDPRService.preview_deletion(user)
        targets = {c["target"] for c in preview["side_channels"]}
        # auditlog + axes always; sepa/reseller only when the persona applies.
        assert {"auditlog", "axes"} <= targets
        assert "sepa_export" not in targets  # no member


@pytest.mark.django_db
class TestPreviewRetentionSurfacing:
    def test_open_coop_share_blocks_and_is_surfaced(self, tenant):
        user = JasminUserFactory(roles=["member"])
        member = MemberFactory(user=user)
        CoopShareFactory(member=member)  # open share → retention block

        preview = GDPRService.preview_deletion(user)

        assert preview["can_anonymize_now"] is False
        assert preview["retention_blocks"], "expected a CoopShare retention block"
        assert any("CoopShare" in reason for reason in preview["retention_blocks"])


@pytest.mark.django_db
class TestPreviewWritesNothing:
    def test_preview_does_not_mutate_the_user_or_member(self, tenant):
        user = JasminUserFactory(roles=["member"], email="real@example.com")
        member = MemberFactory(user=user, first_name="Realname")

        GDPRService.preview_deletion(user)

        user.refresh_from_db()
        member.refresh_from_db()
        assert user.email == "real@example.com"
        assert member.first_name == "Realname"


@pytest.mark.django_db
class TestPreviewEndpoint:
    def _url(self, user_id: str) -> str:
        return reverse("gdpr-admin-preview-deletion", kwargs={"user_id": user_id})

    def test_admin_gets_preview(self, tenant):
        admin = JasminUserFactory(roles=["admin"])
        target = JasminUserFactory(roles=["member"])
        MemberFactory(user=target)

        client = APIClient()
        client.force_authenticate(user=admin)
        resp = client.get(self._url(str(target.id)))

        assert resp.status_code == 200
        assert resp.data["persona"] == "member"
        assert resp.data["user_id"] == str(target.id)
        assert "commissioning.Member" in {m["model"] for m in resp.data["models"]}
        assert "can_anonymize_now" in resp.data

    def test_non_admin_forbidden(self, tenant):
        member_user = JasminUserFactory(roles=["member"])
        target = JasminUserFactory(roles=["member"])

        client = APIClient()
        client.force_authenticate(user=member_user)
        resp = client.get(self._url(str(target.id)))

        assert resp.status_code == 403

    def test_unknown_user_id_404(self, tenant):
        admin = JasminUserFactory(roles=["admin"])
        client = APIClient()
        client.force_authenticate(user=admin)
        resp = client.get(self._url("does-not-exist"))
        assert resp.status_code == 404


@pytest.mark.django_db
class TestPreviewWithoutLogin:
    def test_member_without_login(self, tenant):
        member = MemberFactory(user=None, email="paper@example.com")

        preview = GDPRService.preview_subject_deletion(ErasureSubject.of_member(member))

        assert preview["persona"] == "member"
        assert preview["user_id"] == ""
        assert preview["user_email"] == "paper@example.com"
        models = _models_by_label(preview)
        assert "commissioning.Member" in models
        # No login, so no account and no invitations to scrub.
        assert "accounts.JasminUser" not in models
        assert "commissioning.UserInvitation" not in models

    def test_reseller_without_login(self, tenant):
        reseller = ResellerFactory(linked_user=None)

        preview = GDPRService.preview_subject_deletion(
            ErasureSubject.of_reseller(reseller)
        )

        assert preview["persona"] == "customer"
        assert preview["has_reseller"] is True
        assert "commissioning.Reseller" in _models_by_label(preview)
        assert "accounts.JasminUser" not in _models_by_label(preview)


@pytest.mark.django_db
class TestPendingRequestPreviewEndpoint:
    def _url(self, request_id: str) -> str:
        return reverse(
            "gdpr-admin-preview-pending-deletion", kwargs={"request_id": request_id}
        )

    def _admin_client(self) -> tuple[APIClient, object]:
        admin = JasminUserFactory(roles=["admin"])
        client = APIClient()
        client.force_authenticate(user=admin)
        return client, admin

    def test_previews_a_request_filed_for_a_member_without_login(self, tenant):
        client, admin = self._admin_client()
        member = MemberFactory(user=None)
        deletion_request = GDPRService.file_deletion_for_subject(
            ErasureSubject.of_member(member), admin_user=admin, channel="letter"
        )

        resp = client.get(self._url(str(deletion_request.pk)))

        assert resp.status_code == 200
        assert resp.data["persona"] == "member"
        assert resp.data["user_id"] == ""
        assert "commissioning.Member" in {m["model"] for m in resp.data["models"]}

    def test_previews_a_self_service_request(self, tenant):
        client, _admin = self._admin_client()
        user = JasminUserFactory(roles=["member"])
        MemberFactory(user=user)
        deletion_request = GDPRService.request_deletion(user)
        deletion_request.state = DeletionRequestState.PENDING_ADMIN
        deletion_request.save(update_fields=["state"])

        resp = client.get(self._url(str(deletion_request.pk)))

        assert resp.status_code == 200
        assert resp.data["user_id"] == str(user.pk)

    def test_request_not_waiting_for_approval_is_409(self, tenant):
        client, _admin = self._admin_client()
        user = JasminUserFactory(roles=["member"])
        deletion_request = GDPRService.request_deletion(user)  # PENDING_EMAIL

        resp = client.get(self._url(str(deletion_request.pk)))

        assert resp.status_code == 409
        assert resp.data["code"] == "gdpr.deletion_not_pending_admin"

    def test_non_admin_forbidden(self, tenant):
        _client, admin = self._admin_client()
        member = MemberFactory(user=None)
        deletion_request = GDPRService.file_deletion_for_subject(
            ErasureSubject.of_member(member), admin_user=admin, channel="phone"
        )
        client = APIClient()
        client.force_authenticate(user=JasminUserFactory(roles=["office"]))

        resp = client.get(self._url(str(deletion_request.pk)))

        assert resp.status_code == 403

    def test_unknown_request_404(self, tenant):
        client, _admin = self._admin_client()
        resp = client.get(self._url("does-not-exist"))
        assert resp.status_code == 404
