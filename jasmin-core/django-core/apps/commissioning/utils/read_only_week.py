"""The rule that makes a past week's documentation read-only.

A week stays writable through the week after it — the grace in which a late
count, harvest or purchase is still entered — and turns read-only once it lies
more than one week behind the current ISO week. The documentation pages apply
the same rule (``isWeekInPast`` in ``src/shared/utils/weekRange.ts``: the whole
weeks since the selected week's Monday exceed one), so the server refuses
exactly the weeks those pages show read-only.
"""

from __future__ import annotations

import datetime as _dt

from django.utils import timezone
from isoweek import Week

from ..errors import PastWeekError


def is_week_read_only(year: int, week: int, today: _dt.date | None = None) -> bool:
    """True once two whole weeks have passed since the week's Monday."""
    today = today or timezone.localdate()
    return today >= Week(year, week).monday() + _dt.timedelta(weeks=2)


def refuse_read_only_week(year: int, week: int) -> None:
    """Raise :class:`PastWeekError` (409) for a week that is read-only."""
    if not is_week_read_only(year, week):
        return
    raise PastWeekError(
        f"Week {week} of {year} lies more than a week in the past and can no "
        "longer be changed.",
        details={"year": year, "delivery_week": week},
    )
