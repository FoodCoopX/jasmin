"""Row locks for a write to an existing order line.

A write that changes an order line's amount moves its offer's stock
(``Offer.amount``) by the difference to the stored amount, so it reads that
amount under the line's row lock. Two writes of one line that both read it
before either commits, a double save on the orders grid say, would otherwise
both move the stock by the full difference, and a write that read a line
deleted in the meantime would save it back.

Every path takes its locks in one order — the offer, then the order, then the
line — so two writes never wait on each other the other way round: creating a
line locks its offer and then its order before the line exists, the locks here
follow the same order, and finalizing an order (or building its delivery note)
locks the order before its lines. Holding the order is what keeps a line write
and a finalization apart: a line can't go into, change in or leave an order
while it is being finalized, and the finalization sees every line committed
before it.

The numbering sequences' advisory locks come before any of these row locks: a
finalization holds the order sequence while it bumps a draft order's number.
So a path that numbers or finalizes a document takes the sequence first (as
``DeliveryNoteService.create_from_order`` does), and a write that already holds
an order's row takes no sequence lock — an order that has its number saves
without one (``save_with_number_retry``).
"""

from __future__ import annotations

from django.db import transaction
from django.db.transaction import TransactionManagementError

from ..errors import OrderContentChanged
from ..models import Offer, Order, OrderContent

# How many times a write looks up its line's offer and order before it gives
# up. A retry follows only when another write moved the line between the lookup
# and the lock, so a few attempts cover any real interleaving.
_LOCK_ATTEMPTS = 3


def _stored_parents(order_content_id: str) -> tuple[str | None, str]:
    """The offer and the order of the stored line, read without a lock. Raises
    ``OrderContent.DoesNotExist`` when there is no such line."""
    return (
        OrderContent.objects.filter(id=order_content_id)
        .values_list("offer_id", "order_id")
        .get()
    )


def lock_order_content(order_content_id: str) -> OrderContent:
    """Lock the order line ``order_content_id`` with its offer and its order —
    the offer, then the order, then the line — and return the line as read under
    the lock, its ``offer`` and ``order`` the locked rows.

    The offer and the order come from a read of the line without a lock, so
    another write can move the line before it is locked. That attempt then rolls
    back to its savepoint, which releases the locks, and starts over with the
    line's new parents: waiting for them while holding the line would take the
    locks the other way round.

    Raises ``OrderContent.DoesNotExist`` when there is no such line, also when
    another write deleted it before it was locked, and ``OrderContentChanged``
    when the line moved on every attempt. The locks last until the caller's
    transaction ends, so the caller must run in one.
    """
    if transaction.get_autocommit():
        raise TransactionManagementError(
            "lock_order_content() must run inside a transaction."
        )
    for _attempt in range(_LOCK_ATTEMPTS):
        offer_id, order_id = _stored_parents(order_content_id)
        with transaction.atomic():
            offer = (
                Offer.objects.select_for_update().filter(pk=offer_id).first()
                if offer_id is not None
                else None
            )
            order = Order.objects.select_for_update().filter(pk=order_id).first()
            order_content = OrderContent.objects.select_for_update().get(
                id=order_content_id
            )
            if (
                order_content.offer_id == (offer.pk if offer is not None else None)
                and order is not None
                and order_content.order_id == order.pk
            ):
                order_content.offer = offer
                order_content.order = order
                return order_content
            transaction.set_rollback(True)
    raise OrderContentChanged(
        "The order line moved to another offer or order while it was being saved.",
        details={"order_content_id": order_content_id},
    )
