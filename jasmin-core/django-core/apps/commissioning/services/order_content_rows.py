"""The flat rows the orders grid reads: an order line, the placeholder row of
an offer nothing has ordered yet, and an order's identity and document state."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from django.utils import timezone

from ..models import Offer, OrderContent
from ..utils.tax_rate_utils import resolve_article_tax_rate


def offer_name(offer: Offer | None) -> str | None:
    if not offer:
        return None
    if offer.sort:
        return f"{offer.share_article.name} - {offer.sort}"
    return offer.share_article.name


def amount_per_pu_or_one(offer: Offer | None) -> Decimal | int:
    if offer and offer.amount_per_pu:
        return offer.amount_per_pu
    return 1


def order_identity_dict(order) -> dict[str, Any]:
    """Order identity + day-schedule block shared by the order-content row,
    the unused-offer placeholder, and the order-metadata serializer.
    ``None`` → the placeholder defaults (null identity, unfinalized). Callers
    that also expose ``last_possible_ordering_day`` add it themselves."""
    return {
        "order_id": order.id if order else None,
        "order_number": order.display_number if order else None,
        "order_number_prefix": order.prefix if order else None,
        "order_is_finalized": order.is_finalized if order else False,
        "order_note": (order.note or "") if order else "",
        "harvesting_day": order.harvesting_day if order else None,
        "packing_day": order.packing_day if order else None,
        "washing_day": order.washing_day if order else None,
        "cleaning_day": order.cleaning_day if order else None,
    }


def delivery_note_identity_dict(delivery_note) -> dict[str, Any]:
    """Delivery-note identity/state block; ``None`` → null identity."""
    return {
        "delivery_note_id": delivery_note.id if delivery_note else None,
        "delivery_note_number": (
            delivery_note.display_number if delivery_note else None
        ),
        "delivery_note_prefix": delivery_note.prefix if delivery_note else None,
        "delivery_note_is_finalized": (
            delivery_note.is_finalized if delivery_note else False
        ),
    }


def invoice_identity_dict(invoice) -> dict[str, Any]:
    """Invoice identity/state block; ``None`` → null identity, no invoice."""
    return {
        "invoice_id": invoice.id if invoice else None,
        "invoice_number": invoice.display_number if invoice else None,
        "invoice_prefix": invoice.prefix if invoice else None,
        "has_invoice": invoice is not None,
        "has_finalized_invoice": invoice.is_finalized if invoice else False,
    }


def serialize_order_content(order_content: OrderContent) -> dict[str, Any]:
    """Serialize an OrderContent into a flat dict for API responses."""
    offer = order_content.offer
    return {
        "id": order_content.id,
        # Explicit flag so the frontend never has to infer "is this a
        # real row or a placeholder?" from the shape of other fields.
        # See serialize_unused_offer for the placeholder counterpart.
        "is_placeholder": False,
        **order_identity_dict(order_content.order),
        "last_possible_ordering_day": order_content.order.last_possible_ordering_day,
        "offer": offer.id if offer else None,
        "offer_name": offer_name(offer),
        "offer_available_amount": offer.amount if offer else None,
        "amount_per_pu": offer.amount_per_pu if offer else None,
        "offer_share_article_name": (offer.share_article.name if offer else None),
        "share_article": order_content.share_article_id,
        "share_article_name": (
            order_content.share_article.name if order_content.share_article else None
        ),
        "amount": order_content.amount,
        # Tolerate a NULL amount on READ. The create path normalises None to
        # zero so new rows never carry NULL, but a row written by any other
        # route (data import, shell, a migration) would otherwise divide
        # None here — and this runs once per row on the LIST path, so one
        # such row would 500 the entire orders grid rather than just itself.
        "ordered_amount": (
            (order_content.amount or Decimal("0")) / amount_per_pu_or_one(offer)
        ),
        "size": order_content.size,
        "sort": order_content.sort,
        "note": order_content.note,
        "unit": order_content.unit,
        "price_per_unit": order_content.price_per_unit,
        "price_1": offer.price_1 if offer else None,
        "price_2": offer.price_2 if offer else None,
        "price_3": offer.price_3 if offer else None,
        "rabatt": order_content.rabatt,
        "tax_rate": order_content.tax_rate,
        "washing": order_content.washing,
        "cleaning": order_content.cleaning,
        "comes_from_long_term_storage": order_content.comes_from_long_term_storage,
    }


def serialize_unused_offer(offer: Offer) -> dict[str, Any]:
    """Serialize an Offer that has no matching OrderContent yet.

    The list endpoint mixes these placeholder rows with real OrderContent
    rows so the table can render every available offer in one shot. To
    keep the two row types unambiguous downstream:
      - `is_placeholder = True` is the authoritative flag (the frontend
        routes a save on a placeholder row to CREATE, not UPDATE).
      - `id` carries the offer's id so the row has a unique React key in
        the table; the placeholder flag is what disambiguates it from a
        real OrderContent id, NOT the id field itself.
    """
    return {
        "id": offer.id,
        "is_placeholder": True,
        **order_identity_dict(None),
        "last_possible_ordering_day": None,
        **delivery_note_identity_dict(None),
        **invoice_identity_dict(None),
        "offer": offer.id,
        "offer_name": offer_name(offer),
        "offer_available_amount": offer.amount,
        "amount_per_pu": offer.amount_per_pu,
        "offer_share_article_name": offer.share_article.name,
        "share_article": None,
        "share_article_name": None,
        "amount": None,
        "ordered_amount": None,
        # Carry size/sort/unit through from the offer so a CREATE built
        # from this placeholder row passes the DRF serializer's required-
        # field checks (the service-layer fallback in
        # `create_order_with_content_and_crates` runs AFTER serializer
        # validation, so empty values here would surface as a 400).
        "size": offer.size,
        "sort": offer.sort,
        "note": None,
        "unit": offer.unit,
        "price_per_unit": None,
        "price_1": offer.price_1,
        "price_2": offer.price_2,
        "price_3": offer.price_3,
        "rabatt": None,
        "tax_rate": resolve_article_tax_rate(offer, timezone.localdate()),
        "washing": offer.washing,
        "cleaning": offer.cleaning,
        "comes_from_long_term_storage": offer.comes_from_long_term_storage,
    }


def serialize_order_metadata(order, invoice) -> dict[str, Any]:
    """Top-level order identity + delivery-note / invoice state for a period.

    Surfaced independently of OrderContent rows so the Orders page can
    render and progress a CRATES-ONLY order (an order with crates but no
    share-article content). Uses the same ``order_*`` / ``delivery_note_*``
    / ``invoice_*`` keys the per-row serialization emits, so the frontend
    reads it identically.
    """
    delivery_note = getattr(order, "delivery_note", None)
    return {
        **order_identity_dict(order),
        **delivery_note_identity_dict(delivery_note),
        **invoice_identity_dict(invoice),
    }
