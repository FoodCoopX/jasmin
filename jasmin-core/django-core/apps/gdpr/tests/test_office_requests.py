"""Tests for the requests the office handles for a member or reseller.

Someone without a login, or who asks by letter, email, phone or in person,
can't use the self-service GDPR endpoints. The office erases them (Art. 17)
or exports their data (Art. 15) keyed by the member or reseller record:

  - ``POST /api/gdpr/admin/members/<id>/erase/``
  - ``POST /api/gdpr/admin/resellers/<id>/erase/``
  - ``GET  /api/gdpr/admin/members/<id>/subject-access/``
  - ``GET  /api/gdpr/admin/resellers/<id>/subject-access/``

Erasing files a ``DeletionRequest`` recording who filed it and how the
person asked, then runs it; when retention obligations block it, the request
waits in the pending inbox instead.
"""

from __future__ import annotations

from unittest import mock

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.commissioning.tests.conftest import make_step_up_token
from apps.commissioning.tests.factories import (
    CoopShareFactory,
    JasminUserFactory,
    MemberFactory,
    ResellerFactory,
)
from apps.gdpr.models import DeletionLog, DeletionRequest, DeletionRequestState
from apps.gdpr.services import GDPRService
from apps.gdpr.services.subjects import ErasureSubject


def _admin_client(*, step_up: bool = True, roles=("admin",)):
    admin = JasminUserFactory(roles=list(roles))
    client = APIClient()
    token = make_step_up_token(admin) if step_up else None
    client.force_authenticate(user=admin, token=token)
    return client, admin


def _erase_member(client, member, channel="letter"):
    return client.post(
        reverse("gdpr-admin-erase-member", args=[member.pk]),
        {"channel": channel},
        format="json",
    )


@pytest.mark.django_db
class TestEraseMember:
    def test_erases_a_member_without_a_login_and_records_the_request(self, tenant):
        client, admin = _admin_client()
        member = MemberFactory(
            user=None, first_name="Paper", email="paper@example.com", address="Weg 1"
        )

        response = _erase_member(client, member, channel="letter")

        assert response.status_code == 200, response.content
        assert response.json()["state"] == DeletionRequestState.EXECUTED
        member.refresh_from_db()
        assert member.first_name == "Gelöscht"
        assert member.email is None
        assert member.address is None
        request = DeletionRequest.objects.get(pk=response.json()["request_id"])
        assert request.member_id == member.pk
        assert request.user_id is None
        assert request.channel == "letter"
        assert request.requested_by_id == admin.pk
        assert request.requested_email == "paper@example.com"
        assert request.deletion_log.member_pk == member.pk

    def test_a_member_with_a_login_is_erased_with_it(self, tenant):
        client, _ = _admin_client()
        user = JasminUserFactory(email="login@example.com")
        member = MemberFactory(user=user)

        response = _erase_member(client, member, channel="phone")

        assert response.status_code == 200, response.content
        user.refresh_from_db()
        assert user.email.endswith("@deleted.invalid")
        request = DeletionRequest.objects.get(pk=response.json()["request_id"])
        assert (request.user_id, request.member_id) == (user.pk, member.pk)

    def test_tells_a_member_with_an_email_that_it_is_done(self, tenant):
        client, _ = _admin_client()
        member = MemberFactory(user=None, email="told@example.com")

        with mock.patch(
            "apps.shared.tenants.email_service.EmailService.send_email",
            return_value=True,
        ) as send_email:
            _erase_member(client, member)

        kwargs = send_email.call_args.kwargs
        assert kwargs["slug"] == "gdpr.deletion_approved"
        assert kwargs["to_emails"] == ["told@example.com"]

    def test_sends_nothing_to_a_member_without_an_email(self, tenant):
        client, _ = _admin_client()
        member = MemberFactory(user=None, email=None)

        with mock.patch(
            "apps.shared.tenants.email_service.EmailService.send_email",
            return_value=True,
        ) as send_email:
            response = _erase_member(client, member)

        assert response.status_code == 200
        assert not send_email.called

    def test_a_retention_block_leaves_the_request_pending_in_the_inbox(self, tenant):
        client, _ = _admin_client()
        member = MemberFactory(user=None, first_name="Holder")
        CoopShareFactory(member=member)

        response = _erase_member(client, member)

        assert response.status_code == 409
        body = response.json()
        assert body["code"] == "gdpr.retention_active"
        member.refresh_from_db()
        assert member.first_name == "Holder"
        request = DeletionRequest.objects.get(pk=body["details"]["request_id"])
        assert request.state == DeletionRequestState.PENDING_ADMIN

        inbox = client.get(reverse("gdpr-admin-pending-deletions")).json()["pending"]
        (row,) = [row for row in inbox if row["id"] == request.pk]
        assert row["member_id"] == member.pk
        assert row["channel"] == "letter"
        assert row["subject_label"] == str(member)
        assert row["blockers"]

    def test_the_pending_request_runs_once_the_block_is_gone(self, tenant):
        client, _ = _admin_client()
        member = MemberFactory(user=None, first_name="Later")
        share = CoopShareFactory(member=member)
        request_id = _erase_member(client, member).json()["details"]["request_id"]
        share.delete()

        response = client.post(
            reverse("gdpr-admin-approve-deletion", args=[request_id])
        )

        assert response.status_code == 200, response.content
        member.refresh_from_db()
        assert member.first_name == "Gelöscht"

    def test_a_new_request_supersedes_the_open_one(self, tenant):
        client, _ = _admin_client()
        member = MemberFactory(user=None)
        CoopShareFactory(member=member)
        first = _erase_member(client, member).json()["details"]["request_id"]

        second = _erase_member(client, member, channel="email").json()

        assert DeletionRequest.objects.get(pk=first).state == (
            DeletionRequestState.CANCELLED
        )
        assert DeletionRequest.objects.get(
            pk=second["details"]["request_id"]
        ).state == (DeletionRequestState.PENDING_ADMIN)

    def test_an_erased_member_is_refused(self, tenant):
        client, _ = _admin_client()
        member = MemberFactory(user=None)
        _erase_member(client, member)

        response = _erase_member(client, member)

        assert response.status_code == 409
        assert response.json()["code"] == "gdpr.subject_already_erased"

    @pytest.mark.parametrize("channel", ["", "self_service", "fax", None, ["letter"]])
    def test_the_channel_must_be_one_the_office_can_record(self, tenant, channel):
        client, _ = _admin_client()
        member = MemberFactory(user=None, first_name="Kept")

        response = _erase_member(client, member, channel=channel)

        assert response.status_code == 400
        assert response.json()["code"] == "gdpr.invalid_channel"
        member.refresh_from_db()
        assert member.first_name == "Kept"

    def test_an_unknown_member_is_not_found(self, tenant):
        client, _ = _admin_client()

        response = client.post(
            reverse("gdpr-admin-erase-member", args=["NoSuChMeMbEr"]),
            {"channel": "letter"},
            format="json",
        )

        assert response.status_code == 404

    def test_needs_a_fresh_step_up(self, tenant):
        client, _ = _admin_client(step_up=False)
        member = MemberFactory(user=None, first_name="Kept")

        response = _erase_member(client, member)

        assert response.status_code == 403
        member.refresh_from_db()
        assert member.first_name == "Kept"

    def test_is_for_admins_only(self, tenant):
        client, _ = _admin_client(roles=("office",))
        member = MemberFactory(user=None)

        response = _erase_member(client, member)

        assert response.status_code == 403


@pytest.mark.django_db
class TestEraseReseller:
    def test_erases_a_reseller_without_a_login(self, tenant):
        client, admin = _admin_client()
        reseller = ResellerFactory(invoice_email="billing@shop.example")

        response = client.post(
            reverse("gdpr-admin-erase-reseller", args=[reseller.pk]),
            {"channel": "email"},
            format="json",
        )

        assert response.status_code == 200, response.content
        reseller.refresh_from_db()
        assert reseller.name_for_member_pages == "Gelöscht"
        assert reseller.invoice_email is None
        assert reseller.contact.email is None
        request = DeletionRequest.objects.get(pk=response.json()["request_id"])
        assert (request.reseller_id, request.channel) == (reseller.pk, "email")
        assert DeletionLog.objects.filter(reseller_pk=reseller.pk).exists()


@pytest.mark.django_db
class TestOfficeSubjectAccess:
    def test_exports_a_member_without_a_login(self, tenant):
        client, _ = _admin_client()
        member = MemberFactory(user=None, first_name="Asked", email="asked@example.com")

        response = client.get(
            reverse("gdpr-admin-member-subject-access", args=[member.pk])
        )

        assert response.status_code == 200, response.content
        bundle = response.json()
        assert bundle["account"] is None
        assert bundle["subject"] == {
            "user_id": None,
            "member_id": member.pk,
            "reseller_id": None,
            "email": "asked@example.com",
        }
        assert bundle["member"]["first_name"] == "Asked"

    def test_lists_the_requests_the_office_filed_for_the_member(self, tenant):
        client, admin = _admin_client()
        member = MemberFactory(user=None)
        CoopShareFactory(member=member)
        GDPRService.file_deletion_for_subject(
            ErasureSubject.of_member(member), admin_user=admin, channel="letter"
        )

        bundle = client.get(
            reverse("gdpr-admin-member-subject-access", args=[member.pk])
        ).json()

        assert [row["state"] for row in bundle["deletion_requests"]] == [
            DeletionRequestState.PENDING_ADMIN
        ]

    def test_exports_a_reseller(self, tenant):
        client, _ = _admin_client()
        reseller = ResellerFactory()

        response = client.get(
            reverse("gdpr-admin-reseller-subject-access", args=[reseller.pk])
        )

        assert response.status_code == 200, response.content
        assert response.json()["reseller"]["reseller_id"] == reseller.pk

    def test_needs_a_fresh_step_up(self, tenant):
        client, _ = _admin_client(step_up=False)
        member = MemberFactory(user=None)

        response = client.get(
            reverse("gdpr-admin-member-subject-access", args=[member.pk])
        )

        assert response.status_code == 403

    def test_the_self_service_export_keeps_its_shape(self, tenant):
        user = JasminUserFactory(email="self@example.com")
        MemberFactory(user=user)
        client = APIClient()
        client.force_authenticate(user=user)

        bundle = client.get(reverse("gdpr-my-data")).json()

        assert bundle["subject"] == {"user_id": user.pk, "email": "self@example.com"}
        assert bundle["account"]["email"] == "self@example.com"


@pytest.mark.django_db
class TestDecidedInbox:
    def test_shows_how_the_person_asked(self, tenant):
        client, _ = _admin_client()
        member = MemberFactory(user=None)
        request_id = _erase_member(client, member, channel="in_person").json()[
            "request_id"
        ]

        rows = client.get(reverse("gdpr-admin-decided-deletions")).json()

        (row,) = [row for row in rows if row["id"] == request_id]
        assert row["channel"] == "in_person"
        assert row["state"] == DeletionRequestState.EXECUTED
