"""Consent versioning service.

Owns the write side of ``ConsentRecord`` so the denormalised cache
columns on ``Member`` (``sepa_consent``, ``privacy_consent``,
``withdrawal_consent``) stay in lock-step with the canonical record
table. Views/serializers never write those Member columns directly —
they call ``ConsentService.record(...)`` and ``revoke(...)``.

The cache columns exist for the hot path: "is this member currently
consented to X?" which gets checked in many UI cards and queries
(``Member.sepa_consent is not None and member.billing_profile.is_active``
etc.). Recomputing them from ConsentRecord on every page would join
twice and pick the latest unrevoked row by ``consented_at`` — fine
once, but costly when fanned out across a member list.
"""

from __future__ import annotations

from django.core.mail import mail_admins
from django.db import models, transaction
from django.utils import timezone

from ..errors import (
    ConsentAlreadyRevoked,
    ConsentDocumentNotFound,
    ConsentRevokeReasonReserved,
)
from ..models import ConsentDocument, ConsentKind, ConsentRecord, Member

# Map ``ConsentKind`` → the cache column on ``Member`` that the record
# updates as a side effect. Adding a new kind here makes
# ``record()`` / ``revoke()`` start maintaining it; absence means
# "ConsentRecord is the only place this lives" (which is fine for new
# kinds like ``terms`` that don't have a legacy cache column).
_CACHE_FIELD_BY_KIND: dict[str, str] = {
    ConsentKind.PRIVACY: "privacy_consent",
    ConsentKind.SEPA: "sepa_consent",
    ConsentKind.WITHDRAWAL: "withdrawal_consent",
}

# Withdrawing one of these is a processing-legal-basis withdrawal that needs an
# office review (unlike SEPA, which has its own automated consequence): the
# member is flagged (``consent_withdrawn_at``) and the office is emailed. NOT an
# automatic erasure — processing may still rest on contract / GenG retention.
_FLAG_ON_REVOKE: frozenset[str] = frozenset(
    {ConsentKind.PRIVACY, ConsentKind.WITHDRAWAL}
)

# ``revoked_reason`` of a record closed by ``supersede`` rather than withdrawn.
# A stable token, not prose: the frontend recognises it and shows its own
# translated label (``src/shared/consent/supersededConsent.ts``), and
# ``revoke`` refuses it as a withdrawal reason so the two never mix.
SUPERSEDED_REASON = "superseded"


class ConsentService:
    """Stateless helper — instantiate per request or call class-style."""

    # ------------------------------------------------------------------ #
    # Document lookup                                                    #
    # ------------------------------------------------------------------ #
    @staticmethod
    def get_current_document(
        kind: str,
        locale: str = "de",
        as_of=None,
    ) -> ConsentDocument:
        """Return the active document for ``(kind, locale)`` at ``as_of``.

        Active = ``valid_from <= as_of`` AND
        (``valid_until IS NULL`` OR ``valid_until >= as_of``).
        Auto-succession on create closes the predecessor's
        ``valid_until``, so there's at most one active row per
        (kind, locale) at any given moment — but we still order by
        ``-valid_from`` defensively.

        Raises ``ConsentDocumentNotFound`` if no row matches, so the
        caller can render a clear "no policy uploaded yet" message
        instead of silently consenting the user to nothing.

        ``as_of`` defaults to today's local date: validity windows are
        calendar dates in ``TIME_ZONE``, and the payments app dates mandate
        signatures with the same ``localdate``.
        """
        as_of = as_of or timezone.localdate()
        doc = (
            ConsentDocument.objects.filter(
                kind=kind,
                locale=locale,
                valid_from__lte=as_of,
            )
            .filter(
                models.Q(valid_until__isnull=True) | models.Q(valid_until__gte=as_of)
            )
            .order_by("-valid_from")
            .first()
        )
        if doc is None:
            raise ConsentDocumentNotFound(
                f"No ConsentDocument for kind={kind!r} locale={locale!r} "
                f"effective on or before {as_of.isoformat()}.",
            )
        return doc

    # ------------------------------------------------------------------ #
    # Record consent                                                     #
    # ------------------------------------------------------------------ #
    @staticmethod
    @transaction.atomic
    def record(
        *,
        member: Member,
        document: ConsentDocument,
        ip_address: str | None = None,
        user_agent: str = "",
    ) -> ConsentRecord:
        """Create a ConsentRecord and refresh the Member cache column.

        ``document`` is the *exact* row the user saw — the caller fetched
        it via ``get_current_document`` and showed its ``body`` to the
        member. Don't pass a kind string; pass the document, so we
        capture which version was actually displayed.
        """
        now = timezone.now()
        record = ConsentRecord.objects.create(
            member=member,
            document=document,
            consented_at=now,
            ip_address=ip_address,
            user_agent=user_agent[:500],
        )
        ConsentService._sync_member_cache(member, document.kind)
        # Re-consenting to a flagged kind clears the office review flag: the
        # member has an active legal basis again (if they later withdraw again,
        # ``revoke`` re-flags them).
        if document.kind in _FLAG_ON_REVOKE:
            Member.objects.filter(pk=member.pk).update(consent_withdrawn_at=None)
        return record

    # ------------------------------------------------------------------ #
    # Supersede (a newer consent replaces the member's earlier ones)     #
    # ------------------------------------------------------------------ #
    @staticmethod
    @transaction.atomic
    def supersede(*, member: Member, kind: str) -> int:
        """Close the member's active records of ``kind`` ahead of a new one.

        For kinds where only the latest consent means anything, like the SEPA
        mandate: re-signing it records a new consent, and the earlier one no
        longer authorises anything. Left active it would read as a second,
        separate consent, and revoking it would switch off the current mandate.

        Not a withdrawal: the records get ``SUPERSEDED_REASON``, and none of
        ``revoke``'s side effects run (the SEPA hook, the office review flag).
        Call it right before ``record``, in the same transaction. Returns how
        many records were closed.
        """
        now = timezone.now()
        active = ConsentRecord.objects.select_for_update(of=("self",)).filter(
            member=member, document__kind=kind, revoked_at__isnull=True
        )
        closed = 0
        for consent in active:
            consent.revoked_at = now
            consent.revoked_reason = SUPERSEDED_REASON
            consent.save(update_fields=["revoked_at", "revoked_reason"])
            closed += 1
        ConsentService._sync_member_cache(member, kind)
        return closed

    # ------------------------------------------------------------------ #
    # Revoke (Art. 7(3) — withdraw consent)                              #
    # ------------------------------------------------------------------ #
    @staticmethod
    @transaction.atomic
    def revoke(
        consent: ConsentRecord,
        *,
        reason: str = "",
        revoked_by=None,
    ) -> ConsentRecord:
        """Mark a consent revoked. Refreshes the Member cache to the
        next-latest unrevoked record (or NULL if no consent remains).
        """
        if reason.strip().casefold() == SUPERSEDED_REASON:
            raise ConsentRevokeReasonReserved(
                "This reason is reserved for consents replaced by a new signature."
            )
        # The member row first, as when a SEPA mandate is signed (which
        # supersedes this member's consents), so the two can't deadlock. Then
        # the record as it stands now, not as the caller read it: a consent
        # superseded meanwhile must not be withdrawn on top.
        Member.objects.select_for_update().filter(pk=consent.member_id).first()
        consent = ConsentRecord.objects.select_for_update().get(pk=consent.pk)
        if consent.revoked_at is not None:
            raise ConsentAlreadyRevoked(
                f"ConsentRecord {consent.pk} was already revoked at "
                f"{consent.revoked_at.isoformat()}."
            )
        consent.revoked_at = timezone.now()
        consent.revoked_reason = reason[:200]
        consent.revoked_by = revoked_by
        consent.save(update_fields=["revoked_at", "revoked_reason", "revoked_by"])
        ConsentService._sync_member_cache(consent.member, consent.document.kind)

        # Withdrawing the SEPA mandate consent (Art. 7(3)) must actually stop
        # the direct debit — payments switches the member's BillingProfile off
        # SEPA via this shared seam (commissioning must not import payments).
        # Inside the same atomic block: a handler failure rolls the revoke back.
        if consent.document.kind == ConsentKind.SEPA:
            from apps.shared.sepa_mandate_hooks import notify_sepa_mandate_revoked

            notify_sepa_mandate_revoked(consent.member)

        # Privacy / withdrawal-terms consent is a processing legal basis:
        # withdrawing it needs a HUMAN review (not an automatic erasure). Flag
        # the member for the office and email them. Emailed on_commit so a mail
        # hiccup can't roll back the (committed) revoke.
        if consent.document.kind in _FLAG_ON_REVOKE:
            ConsentService._flag_member_for_consent_review(consent)

        return consent

    @staticmethod
    def _flag_member_for_consent_review(consent: ConsentRecord) -> None:
        member = consent.member
        Member.objects.filter(pk=member.pk).update(consent_withdrawn_at=timezone.now())
        kind_label = ConsentKind(consent.document.kind).label
        subject = f"[Consent withdrawn] {member} withdrew {kind_label}"
        message = (
            f"Member {member} (id={member.pk}) withdrew their '{kind_label}' "
            f"consent.\n\n"
            f"Withdrawing a processing-legal-basis consent needs an office "
            f"review: confirm whether processing may continue on another legal "
            f"basis (contract / GenG retention) or must be restricted. This is "
            f"NOT an automatic erasure. The member stays flagged "
            f"(consent_withdrawn_at) until they re-consent."
        )
        transaction.on_commit(lambda: mail_admins(subject, message, fail_silently=True))

    # ------------------------------------------------------------------ #
    # Cache maintenance                                                  #
    # ------------------------------------------------------------------ #
    @staticmethod
    def _sync_member_cache(member: Member, kind: str) -> None:
        """Set ``Member.<kind>_consent`` to the latest active record's
        ``consented_at``, or NULL if none. Always reads from the DB so
        a concurrent revoke can't leave the cache pointing at a
        revoked row.
        """
        field_name = _CACHE_FIELD_BY_KIND.get(kind)
        if field_name is None:
            return  # Kind doesn't have a legacy cache column — fine.
        latest = (
            ConsentRecord.objects.filter(
                member=member,
                document__kind=kind,
                revoked_at__isnull=True,
            )
            .order_by("-consented_at")
            .values_list("consented_at", flat=True)
            .first()
        )
        Member.objects.filter(pk=member.pk).update(**{field_name: latest})
