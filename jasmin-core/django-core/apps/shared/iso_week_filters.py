"""Filters on the ISO ``(year, week)`` pair a row stores instead of a date.

ISO weeks order like their ``(year, week)`` tuples, so a range of them is a
lexicographic comparison on the two columns. ``prefix`` reaches the pair
through a relation (``"share__"``); ``week_field`` names the week column,
``delivery_week`` on most models and ``week`` on some. Domain-free, so any app
may use it.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from django.db.models import Q


def iso_week_window(
    first: tuple[int, int],
    last: tuple[int, int],
    prefix: str = "",
    week_field: str = "delivery_week",
) -> Q:
    """The rows of the ISO weeks from ``first`` to ``last`` (``(year, week)``,
    both included); none when ``first`` comes after ``last``. Unlike a
    ``year__in`` × ``delivery_week__in`` filter, it selects no week of another
    year."""
    if first > last:
        return Q(pk__in=[])
    year, week = f"{prefix}year", f"{prefix}{week_field}"
    (first_year, first_week), (last_year, last_week) = first, last
    if first_year == last_year:
        return Q(
            **{year: first_year, f"{week}__gte": first_week, f"{week}__lte": last_week}
        )
    return (
        Q(**{year: first_year, f"{week}__gte": first_week})
        | Q(**{f"{year}__gt": first_year, f"{year}__lt": last_year})
        | Q(**{year: last_year, f"{week}__lte": last_week})
    )


def iso_week_window_for_dates(
    start: date, end: date, prefix: str = "", week_field: str = "delivery_week"
) -> Q:
    """The rows of every ISO week the dates ``start`` to ``end`` touch, a
    partial first or last week whole."""
    first, last = start.isocalendar(), end.isocalendar()
    return iso_week_window(
        (first.year, first.week), (last.year, last.week), prefix, week_field
    )


def iso_week_bound(
    week: tuple[int, int],
    lookup: Literal["gt", "gte", "lt", "lte"],
    prefix: str = "",
    week_field: str = "delivery_week",
) -> Q:
    """The rows whose ISO week compares to ``week`` (``(year, week)``) as the
    Django ``lookup`` says: after it (``gt``), from it on (``gte``), before it
    (``lt``) or up to it (``lte``)."""
    year, week_number = week
    year_lookup = "gt" if lookup in ("gt", "gte") else "lt"
    return Q(**{f"{prefix}year__{year_lookup}": year}) | Q(
        **{f"{prefix}year": year, f"{prefix}{week_field}__{lookup}": week_number}
    )
