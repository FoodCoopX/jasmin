"""When the office may still delete an offer, and deleting it.

An offer may go, finalized or not, while nobody can have acted on it:

* no order, delivery-note or invoice line points at it — those lines would be
  deleted with it (``OrderableItem.offer`` cascades);
* a finalized offer hasn't gone out by email yet: no send of its offer group's
  week reached any reseller — every reseller of the group sees all of the
  group's finalized offers, whatever ``Offer.reseller`` says. A send is recorded
  per offer group and week, not per offer (``OfferSending``), and its email
  links to the live offer page, so an offer added to a week that has been sent
  counts as sent too.

A draft is never in front of a reseller to order from, so only its lines stop
it.
"""

from __future__ import annotations

from typing import Protocol, cast

from django.db import transaction
from django.db.models import Exists, OuterRef, QuerySet

from ..errors import OfferAlreadyOrdered, OfferAlreadySent
from ..models import (
    DeliveryNoteContent,
    InvoiceResellerContent,
    Offer,
    OfferSending,
    OrderContent,
)


class _DeletabilityFlags(Protocol):
    """The facts ``annotate_offer_deletability`` puts on each offer."""

    has_order_lines: bool
    has_delivery_note_lines: bool
    has_invoice_lines: bool
    week_sent: bool


def annotate_offer_deletability(queryset: QuerySet[Offer]) -> QuerySet[Offer]:
    """Mark each offer with the facts ``offer_deletion_blocker`` reads, as
    ``Exists`` subqueries, so a list of offers costs no query per row."""
    return queryset.annotate(
        has_order_lines=Exists(OrderContent.objects.filter(offer=OuterRef("pk"))),
        has_delivery_note_lines=Exists(
            DeliveryNoteContent.objects.filter(offer=OuterRef("pk"))
        ),
        has_invoice_lines=Exists(
            InvoiceResellerContent.objects.filter(offer=OuterRef("pk"))
        ),
        week_sent=Exists(
            OfferSending.objects.filter(
                offer_group=OuterRef("offer_group"),
                year=OuterRef("year"),
                delivery_week=OuterRef("delivery_week"),
            )
        ),
    )


def offer_deletion_blocker(
    offer: Offer,
) -> type[OfferAlreadyOrdered] | type[OfferAlreadySent] | None:
    """Why the office may no longer delete ``offer``, or ``None`` while it may."""
    flags = _deletability_flags(offer)
    if (
        flags.has_order_lines
        or flags.has_delivery_note_lines
        or flags.has_invoice_lines
    ):
        return OfferAlreadyOrdered
    if offer.is_finalized and flags.week_sent:
        return OfferAlreadySent
    return None


def _deletability_flags(offer: Offer) -> _DeletabilityFlags:
    """``offer``'s ``annotate_offer_deletability`` flags, asked of the database
    when ``offer`` was loaded without them."""
    if not hasattr(offer, "has_order_lines"):
        offer = annotate_offer_deletability(Offer.objects.filter(pk=offer.pk)).get()
    # Annotations aren't part of ``Offer``'s type; past the check above, the
    # row carries all four.
    return cast(_DeletabilityFlags, offer)


def delete_offer(offer: Offer) -> None:
    """Delete ``offer`` unless ``offer_deletion_blocker`` refuses. A finalized
    offer is turned back into a draft first: its finalization protection, in
    Python and in the database trigger, refuses to delete a finalized row but
    lets an offer be unfinalized."""
    with transaction.atomic():
        # Lock first, read the flags in a statement of their own: a statement
        # that waits for the lock still evaluates its subqueries against the
        # snapshot it took before waiting, so it would miss an order line
        # committed by the order placement holding the lock. Once the lock is
        # held, a new line for this offer waits for the delete and then fails.
        Offer.objects.select_for_update().filter(pk=offer.pk).get()
        locked = annotate_offer_deletability(Offer.objects.filter(pk=offer.pk)).get()
        blocker = offer_deletion_blocker(locked)
        if blocker is not None:
            raise blocker()
        if locked.is_finalized:
            locked.unfinalize()
        locked.delete()
