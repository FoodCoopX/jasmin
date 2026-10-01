"""Member self-service SEPA mandate: ``POST /api/payments/my_sepa_mandate/``.

A member signs a mandate for their own account, or re-signs one that has never
been collected against. The member comes from the session, the signature date
and the reference are set server-side, and the consent is recorded against the
mandate text the member accepted in the same transaction, replacing their
earlier SEPA consent. A mandate already used for a collection, and a profile
the office has deactivated, stay with the office.
"""

from __future__ import annotations

import datetime
from unittest import mock

import pytest
import time_machine
from rest_framework import status
from rest_framework.test import APIClient

from apps.commissioning.errors import ConsentAlreadyRevoked
from apps.commissioning.models import ConsentDocument, ConsentKind, ConsentRecord
from apps.commissioning.services import ConsentService
from apps.commissioning.services.consent_service import SUPERSEDED_REASON
from apps.commissioning.tests.conftest import make_step_up_token
from apps.commissioning.tests.factories import JasminUserFactory, MemberFactory
from apps.payments.constants import PaymentMethodOptions
from apps.payments.models import BillingProfile

URL = "/api/payments/my_sepa_mandate/"
TODAY = datetime.date(2026, 3, 2)
CANONICAL_IBAN = "CH9300762011623852957"


@pytest.fixture(autouse=True)
def _frozen_today():
    """Pin "today" to Monday 2026-03-02: the endpoint stamps today as the
    signature date and accepts only the mandate text in force today."""
    with time_machine.travel(datetime.datetime(2026, 3, 2, 12, 0), tick=False):
        yield


@pytest.fixture()
def sepa_document(tenant):
    """The SEPA mandate text in force today."""
    return ConsentDocument.objects.create(
        kind=ConsentKind.SEPA,
        locale="de",
        version="v1",
        valid_from=datetime.date(2026, 1, 1),
        body="SEPA-Lastschriftmandat …",
    )


def _step_up_client(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user, token=make_step_up_token(user))
    return client


@pytest.fixture()
def member_step_up_client(member):
    """The member's client, with a fresh step-up claim: the endpoint writes an
    IBAN, so it is step-up gated."""
    return _step_up_client(member.user)


def _sign(client, document, **overrides):
    payload = {
        "iban": "ch93 0076 2011 6238 5295 7",
        "account_holder": "Mara Beispiel",
        "consent_document_id": document.pk,
        **overrides,
    }
    return client.post(URL, payload, format="json", HTTP_USER_AGENT="pytest-agent")


@pytest.mark.django_db
class TestFirstMandate:
    def test_creates_a_sepa_ready_profile(
        self, member_step_up_client, member, sepa_document
    ):
        resp = _sign(member_step_up_client, sepa_document)

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        profile = BillingProfile.objects.get(member=member)
        assert profile.iban == CANONICAL_IBAN
        assert profile.account_holder == "Mara Beispiel"
        assert profile.payment_method == PaymentMethodOptions.SEPA_DIRECT_DEBIT
        assert profile.is_active is True
        assert profile.sepa_mandate_signed_at == TODAY
        assert profile.sepa_mandate_reference.startswith("MND-")
        assert profile.sepa_mandate_first_use_at is None
        assert profile.is_sepa_ready is True

    def test_response_is_the_member_shape(self, member_step_up_client, sepa_document):
        resp = _sign(member_step_up_client, sepa_document)

        assert resp.status_code == status.HTTP_201_CREATED
        assert resp.data["is_sepa_ready"] is True
        assert resp.data["iban_masked"]
        assert "iban" not in resp.data
        assert "account_holder" not in resp.data
        assert "notes" not in resp.data

    def test_consent_is_recorded_against_the_accepted_text(
        self, member_step_up_client, member, sepa_document
    ):
        _sign(member_step_up_client, sepa_document)

        record = ConsentRecord.objects.get(member=member)
        assert record.document_id == sepa_document.pk
        assert record.ip_address == "127.0.0.1"
        assert record.user_agent == "pytest-agent"
        member.refresh_from_db()
        assert member.sepa_consent is not None

    def test_text_in_another_locale_is_accepted(self, member_step_up_client, tenant):
        # The consent block shows the text in the member's UI language; the
        # consent names that text, whichever locale it is.
        english = ConsentDocument.objects.create(
            kind=ConsentKind.SEPA,
            locale="en",
            version="v1",
            valid_from=datetime.date(2026, 1, 1),
            body="SEPA direct debit mandate …",
        )

        resp = _sign(member_step_up_client, english)

        assert resp.status_code == status.HTTP_201_CREATED, resp.data


@pytest.mark.django_db
class TestReSigningAnUnusedMandate:
    def test_updates_the_profile_in_place(
        self, member_step_up_client, billing_profile, sepa_document
    ):
        billing_profile.sepa_mandate_paper_received_at = datetime.date(2026, 1, 10)
        billing_profile.save()
        previous_reference = billing_profile.sepa_mandate_reference

        resp = _sign(member_step_up_client, sepa_document)

        assert resp.status_code == status.HTTP_200_OK, resp.data
        assert BillingProfile.objects.count() == 1
        billing_profile.refresh_from_db()
        assert billing_profile.iban == CANONICAL_IBAN
        assert billing_profile.sepa_mandate_signed_at == TODAY
        # Another account gets another reference: the bank may already hold
        # the old one, for instance for an imported mandate.
        assert billing_profile.sepa_mandate_reference != previous_reference
        assert billing_profile.sepa_mandate_reference.startswith("MND-")
        # The paper on file was signed for the mandate as it stood before.
        assert billing_profile.sepa_mandate_paper_received_at is None

    def test_same_account_keeps_its_reference(
        self, member_step_up_client, billing_profile, sepa_document
    ):
        previous_reference = billing_profile.sepa_mandate_reference

        # The stored account, typed with spaces.
        resp = _sign(
            member_step_up_client,
            sepa_document,
            iban="DE89 3704 0044 0532 0130 00",
            account_holder="Mara Beispiel-Neu",
        )

        assert resp.status_code == status.HTTP_200_OK, resp.data
        billing_profile.refresh_from_db()
        assert billing_profile.sepa_mandate_reference == previous_reference
        assert billing_profile.account_holder == "Mara Beispiel-Neu"
        assert billing_profile.sepa_mandate_signed_at == TODAY

    def test_re_arms_a_profile_moved_off_sepa(
        self, member_step_up_client, billing_profile, sepa_document
    ):
        # Withdrawing SEPA consent switches the profile to bank transfer and
        # keeps the mandate columns.
        billing_profile.payment_method = PaymentMethodOptions.BANK_TRANSFER
        billing_profile.save()

        resp = _sign(member_step_up_client, sepa_document)

        assert resp.status_code == status.HTTP_200_OK, resp.data
        billing_profile.refresh_from_db()
        assert billing_profile.payment_method == PaymentMethodOptions.SEPA_DIRECT_DEBIT
        assert billing_profile.is_sepa_ready is True


@pytest.mark.django_db
class TestConsentHistory:
    """At most one active SEPA consent per member: the one behind the current
    mandate. Revoking it is what withdraws the mandate."""

    def test_re_signing_supersedes_the_earlier_consent(
        self, member_step_up_client, member, sepa_document
    ):
        _sign(member_step_up_client, sepa_document)
        _sign(
            member_step_up_client,
            sepa_document,
            iban="DE89 3704 0044 0532 0130 00",
        )

        active = ConsentRecord.objects.get(member=member, revoked_at__isnull=True)
        superseded = ConsentRecord.objects.get(member=member, revoked_at__isnull=False)
        assert superseded.revoked_reason == SUPERSEDED_REASON
        member.refresh_from_db()
        assert member.sepa_consent == active.consented_at
        # Superseding is not a withdrawal: the mandate stays armed.
        assert BillingProfile.objects.get(member=member).is_sepa_ready is True

    def test_revoking_the_current_consent_withdraws_the_mandate(
        self, member_step_up_client, member, sepa_document
    ):
        _sign(member_step_up_client, sepa_document)
        _sign(
            member_step_up_client,
            sepa_document,
            iban="DE89 3704 0044 0532 0130 00",
        )

        ConsentService.revoke(
            ConsentRecord.objects.get(member=member, revoked_at__isnull=True)
        )

        profile = BillingProfile.objects.get(member=member)
        assert profile.payment_method == PaymentMethodOptions.BANK_TRANSFER
        member.refresh_from_db()
        assert member.sepa_consent is None

    def test_superseded_consent_cannot_be_revoked(
        self, member_step_up_client, member, sepa_document
    ):
        _sign(member_step_up_client, sepa_document)
        _sign(
            member_step_up_client,
            sepa_document,
            iban="DE89 3704 0044 0532 0130 00",
        )
        superseded = ConsentRecord.objects.get(member=member, revoked_at__isnull=False)

        with pytest.raises(ConsentAlreadyRevoked):
            ConsentService.revoke(superseded)

        assert BillingProfile.objects.get(member=member).is_sepa_ready is True


@pytest.mark.django_db
class TestRefusals:
    def test_used_mandate_stays_with_the_office(
        self, member_step_up_client, billing_profile, sepa_document
    ):
        billing_profile.sepa_mandate_first_use_at = datetime.date(2026, 2, 1)
        billing_profile.save()

        resp = _sign(member_step_up_client, sepa_document)

        assert resp.status_code == status.HTTP_409_CONFLICT
        assert resp.data["code"] == "billing_profile.mandate_already_used"
        billing_profile.refresh_from_db()
        assert billing_profile.iban == "DE89370400440532013000"
        assert billing_profile.sepa_mandate_signed_at == datetime.date(2026, 1, 1)
        assert not ConsentRecord.objects.exists()

    def test_deactivated_profile_stays_with_the_office(
        self, member_step_up_client, billing_profile, sepa_document
    ):
        # Only the office deactivates a profile, to stop collection; lifting
        # that is its decision too.
        billing_profile.is_active = False
        billing_profile.save()

        resp = _sign(member_step_up_client, sepa_document)

        assert resp.status_code == status.HTTP_409_CONFLICT
        assert resp.data["code"] == "billing_profile.mandate_deactivated"
        billing_profile.refresh_from_db()
        assert billing_profile.is_active is False
        assert billing_profile.iban == "DE89370400440532013000"
        assert not ConsentRecord.objects.exists()

    def test_requires_step_up(self, member_api_client, member, sepa_document):
        resp = _sign(member_api_client, sepa_document)

        assert resp.status_code == status.HTTP_403_FORBIDDEN
        assert resp.data["code"] == "auth.step_up_required"
        assert not BillingProfile.objects.filter(member=member).exists()

    def test_anonymous_is_rejected(self, anon_client, sepa_document):
        resp = _sign(anon_client, sepa_document)

        assert resp.status_code in (
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
        )

    def test_internal_role_without_member_role_is_forbidden(
        self, tenant, sepa_document
    ):
        gardener = JasminUserFactory(roles=["gardener"])

        resp = _sign(_step_up_client(gardener), sepa_document)

        assert resp.status_code == status.HTTP_403_FORBIDDEN
        assert not BillingProfile.objects.exists()

    def test_user_without_a_member_profile_is_refused(self, user, sepa_document):
        # The office role passes the role gate, but there is no member of its
        # own to sign for, and the endpoint takes no target member.
        resp = _sign(_step_up_client(user), sepa_document)

        assert resp.status_code == status.HTTP_404_NOT_FOUND
        assert resp.data["code"] == "member.profile_not_linked"
        assert not BillingProfile.objects.exists()

    def test_malformed_iban_is_refused(self, member_step_up_client, sepa_document):
        resp = _sign(member_step_up_client, sepa_document, iban="DE00 NOT-AN-IBAN")

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert not BillingProfile.objects.exists()
        assert not ConsentRecord.objects.exists()

    @pytest.mark.parametrize(
        "kind",
        [ConsentKind.PRIVACY, ConsentKind.TERMS, ConsentKind.COOP_CONTRACT],
    )
    def test_text_of_another_kind_is_refused(self, member_step_up_client, tenant, kind):
        other = ConsentDocument.objects.create(
            kind=kind,
            locale="de",
            version="v1",
            valid_from=datetime.date(2026, 1, 1),
            body="Not a mandate text.",
        )

        resp = _sign(member_step_up_client, other)

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.data["code"] == "billing_profile.sepa_mandate_text_not_current"
        assert not BillingProfile.objects.exists()
        assert not ConsentRecord.objects.exists()

    def test_superseded_text_is_refused(self, member_step_up_client, sepa_document):
        # Publishing a successor closes the previous text the day before.
        successor = ConsentDocument.objects.create(
            kind=ConsentKind.SEPA,
            locale="de",
            version="v2",
            valid_from=TODAY,
            body="SEPA-Lastschriftmandat, neue Fassung …",
        )

        resp = _sign(member_step_up_client, sepa_document)

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.data["code"] == "billing_profile.sepa_mandate_text_not_current"
        assert _sign(member_step_up_client, successor).status_code == (
            status.HTTP_201_CREATED
        )

    def test_text_not_yet_in_force_is_refused(self, member_step_up_client, tenant):
        upcoming = ConsentDocument.objects.create(
            kind=ConsentKind.SEPA,
            locale="de",
            version="v1",
            valid_from=datetime.date(2026, 4, 1),
            body="SEPA-Lastschriftmandat …",
        )

        resp = _sign(member_step_up_client, upcoming)

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.data["code"] == "billing_profile.sepa_mandate_text_not_current"

    def test_unknown_text_is_refused(self, member_step_up_client, tenant):
        resp = member_step_up_client.post(
            URL,
            {
                "iban": CANONICAL_IBAN,
                "account_holder": "Mara Beispiel",
                "consent_document_id": "does-not-exist",
            },
            format="json",
        )

        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.data["code"] == "billing_profile.sepa_mandate_text_not_current"


@pytest.mark.django_db
class TestLocalCalendarDay:
    def test_text_and_signature_date_follow_the_local_date(
        self, settings, member, sepa_document
    ):
        settings.TIME_ZONE = "Europe/Berlin"
        # 23:30 UTC on 1 November is already 2 November in Berlin, the day the
        # successor text takes effect.
        with time_machine.travel(
            datetime.datetime(2026, 11, 1, 23, 30, tzinfo=datetime.UTC), tick=False
        ):
            successor = ConsentDocument.objects.create(
                kind=ConsentKind.SEPA,
                locale="de",
                version="v2",
                valid_from=datetime.date(2026, 11, 2),
                body="SEPA-Lastschriftmandat, neue Fassung …",
            )
            client = _step_up_client(member.user)
            current = ConsentService.get_current_document(
                kind=ConsentKind.SEPA, locale="de"
            )
            refused = _sign(client, sepa_document)
            signed = _sign(client, successor)

        assert current.pk == successor.pk
        assert refused.status_code == status.HTTP_400_BAD_REQUEST
        assert refused.data["code"] == "billing_profile.sepa_mandate_text_not_current"
        assert signed.status_code == status.HTTP_201_CREATED, signed.data
        profile = BillingProfile.objects.get(member=member)
        assert profile.sepa_mandate_signed_at == datetime.date(2026, 11, 2)


@pytest.mark.django_db
class TestOwnership:
    def test_only_the_callers_own_profile_is_written(
        self, member_step_up_client, member, sepa_document
    ):
        other_member = MemberFactory()
        other_profile = BillingProfile.objects.create(
            member=other_member,
            payment_method=PaymentMethodOptions.SEPA_DIRECT_DEBIT,
            iban="DE89370400440532013000",
            account_holder="Other Member",
            sepa_mandate_reference="MND-OTHER",
            sepa_mandate_signed_at=datetime.date(2026, 1, 1),
            is_active=True,
        )

        # A client-supplied target is not part of the contract and is ignored.
        resp = _sign(member_step_up_client, sepa_document, member=other_member.pk)

        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        assert BillingProfile.objects.get(member=member).iban == CANONICAL_IBAN
        other_profile.refresh_from_db()
        assert other_profile.iban == "DE89370400440532013000"
        assert other_profile.account_holder == "Other Member"
        assert not ConsentRecord.objects.filter(member=other_member).exists()

    def test_mandate_and_consent_commit_together(
        self, member_step_up_client, member, sepa_document
    ):
        with mock.patch(
            "apps.payments.services.ConsentService.record",
            side_effect=RuntimeError("consent store unavailable"),
        ):
            resp = _sign(member_step_up_client, sepa_document)

        assert resp.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert not BillingProfile.objects.filter(member=member).exists()
