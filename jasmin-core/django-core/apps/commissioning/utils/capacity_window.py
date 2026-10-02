"""Shared capacity-window parsing + ``capacity_by_week`` dict building.

The delivery-station-day and the share-type-variation capacity serializers
expose the SAME ``{"<year>-<week>": {occupied, free}}`` surface over the SAME
``year`` / ``delivery_week`` / ``num_weeks`` query window. Both the window
parsing and the per-week ``{occupied, free}`` assembly live here so the two
axes can't drift apart on the wire.
"""

from __future__ import annotations

from .query_params import validate_query_params

# Request attribute the parsed window is memoized under.
_WINDOW_CACHE_ATTR = "_parsed_capacity_window"


def parse_capacity_window(request) -> tuple[int | None, int | None, int]:
    """Resolve ``(year, start_week, num_weeks)`` from a request's query params.

    Returns ``(None, None, 52)`` when there's no request, or when ``year`` /
    ``delivery_week`` aren't both present — the serializers read that as "no
    capacity window on the request" and emit ``None``. ``num_weeks`` defaults to
    52 (its catalogue default). Validates via the central query-param catalogue,
    so a malformed value is a clean 400, not a 500.

    ``capacity_by_week`` is a per-row ``SerializerMethodField``, so the window is
    memoized on the request object: one list response would otherwise re-run the
    same catalogue validation once per row, on both capacity axes.
    """
    if not request:
        return None, None, 52
    cached = getattr(request, _WINDOW_CACHE_ATTR, None)
    if cached is not None:
        return cached
    parsed = validate_query_params(
        request,
        optional=["year", "delivery_week", "num_weeks"],
    )
    year = parsed["year"]
    start_week = parsed["delivery_week"]
    num_weeks = parsed["num_weeks"]
    window: tuple[int | None, int | None, int]
    if year is not None and start_week is not None:
        window = (year, start_week, num_weeks)
    else:
        window = (None, None, 52)
    setattr(request, _WINDOW_CACHE_ATTR, window)
    return window


def build_capacity_by_week(
    year_weeks: list[tuple[int, int]],
    counts: dict[tuple[str, int, int], int],
    obj_id: str,
    capacity: int,
) -> dict[str, dict[str, int]]:
    """Assemble the ``{"<year>-<week>": {occupied, free}}`` map for one object.

    ``counts`` is the batched occupancy keyed by ``(obj_id, year, week)``;
    missing keys read as 0. ``free`` is ``max(0, capacity - occupied)``.
    """
    result: dict[str, dict[str, int]] = {}
    for current_year, week in year_weeks:
        occupied = counts.get((obj_id, current_year, week), 0)
        free = max(0, capacity - occupied)
        result[f"{current_year}-{week}"] = {"occupied": occupied, "free": free}
    return result
