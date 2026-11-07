"""What the members collecting at one delivery station find in their shares.

The notice printed for a station: one entry per physical share type variation
somebody collects there on the delivery day, each with the amount one share of
it holds of every article. Planned contents are copied to every station the day
serves, whoever collects there, so the variations come from the station's
demand, not from its contents.
"""

from __future__ import annotations

from typing import Any, NamedTuple

from ..models import ShareArticle, SharesDeliveryDay, VirtualVariationComponent
from ..utils.packing_queries import packing_share_contents
from .packing_list_service import PackingListService
from .share_demand_service import ShareDemandService


def get_station_contents(
    *,
    year: int,
    delivery_week: int,
    day_number: int,
    delivery_station: str,
    is_past: bool,
) -> dict[str, Any]:
    """The shares collected at ``delivery_station`` with their contents.

    Shares come in the member-amounts order (base share types before
    additional ones, then by sort order and size); a share whose contents are
    all zero is left out, and so is a variation nobody collects there.
    """
    matrix = PackingListService.get_member_amounts_matrix(
        year=year,
        delivery_week=delivery_week,
        day_number=day_number,
        is_past=is_past,
        delivery_station=delivery_station,
    )
    collected = _collected_variation_ids(
        year=year,
        delivery_week=delivery_week,
        day_number=day_number,
        delivery_station=delivery_station,
    )
    notes_and_sellers = _note_and_seller_by_variation(
        year=year,
        delivery_week=delivery_week,
        day_number=day_number,
        delivery_station=delivery_station,
        is_past=is_past,
    )
    organic_status_by_article = dict(
        ShareArticle.objects.filter(
            id__in={row["share_article_id"] for row in matrix["rows"]}
        ).values_list("id", "organic_status")
    )

    shares: list[dict[str, Any]] = []
    for column in matrix["columns"]:
        variation_id = column["base_variation_id"]
        if variation_id not in collected:
            continue
        items = [
            _station_contents_item(
                row,
                row[column["key"]],
                notes_and_sellers.get(
                    (variation_id, row["id"]), _NoteAndSeller("", "")
                ),
                organic_status_by_article[row["share_article_id"]],
            )
            for row in matrix["rows"]
            if row.get(column["key"])
        ]
        if not items:
            continue
        shares.append(
            {
                "variation_id": variation_id,
                "size": column["base_size"],
                "share_type_id": column["base_share_type_id"],
                "share_type_name": column["base_share_type_name"],
                "is_packed_bulk": column["base_is_packed_bulk"],
                "items": items,
            }
        )
    return {"shares": shares}


class _NoteAndSeller(NamedTuple):
    note: str
    seller_name_for_member_pages: str


def _station_contents_item(
    row: dict[str, Any],
    amount: Any,
    note_and_seller: _NoteAndSeller,
    organic_status: str,
) -> dict[str, Any]:
    """One article of a share: the member-amounts row with the share's own
    amount, note and seller."""
    return {
        "id": row["id"],
        "share_article_id": row["share_article_id"],
        "share_article_name": row["share_article_name"],
        "amount": amount,
        "unit": row["unit"] or "",
        "size": row["size"] or "",
        "note": note_and_seller.note,
        "seller_name_for_member_pages": note_and_seller.seller_name_for_member_pages,
        "organic_status": organic_status,
    }


def _collected_variation_ids(
    *, year: int, delivery_week: int, day_number: int, delivery_station: str
) -> set[str]:
    """The physical variations collected at the station on the delivery day.

    Read through the demand service, so a tenant that imports its weekly
    demand gets the same answer as one that derives it from subscriptions. A
    virtual variation has no contents of its own and counts as its physical
    components.
    """
    demanded = {
        row["variation_id"]
        for row in ShareDemandService.aggregated_rows(
            year=year,
            delivery_week=delivery_week,
            delivery_day_ids=SharesDeliveryDay.objects.filter(
                day_number=day_number
            ).values_list("id", flat=True),
            delivery_station_id=delivery_station,
        )
        if row["count"] > 0
    }
    components: dict[str, set[str]] = {}
    for virtual_id, physical_id in VirtualVariationComponent.objects.filter(
        virtual_variation_id__in=demanded
    ).values_list("virtual_variation_id", "physical_variation_id"):
        components.setdefault(virtual_id, set()).add(physical_id)
    collected: set[str] = set()
    for variation_id in demanded:
        collected |= components.get(variation_id, {variation_id})
    return collected


def _note_and_seller_by_variation(
    *,
    year: int,
    delivery_week: int,
    day_number: int,
    delivery_station: str,
    is_past: bool,
) -> dict[tuple[str, str], _NoteAndSeller]:
    """Each share's own note on an article and the name its seller shows
    members, keyed by its variation and the member-amounts row id (article,
    unit and size). The member-amounts matrix keeps one note per row,
    whichever variation's it read first, and no seller."""
    contents = packing_share_contents(
        year,
        delivery_week,
        day_number,
        is_past=is_past,
        delivery_station=delivery_station,
    ).values_list(
        "share__share_type_variation_id",
        "share_article_id",
        "unit",
        "size",
        "note",
        "seller__name_for_member_pages",
    )
    return {
        (variation_id, f"{article_id}_{unit}_{size}"): _NoteAndSeller(
            note or "", seller or ""
        )
        for variation_id, article_id, unit, size, note, seller in contents
        if note or seller
    }
