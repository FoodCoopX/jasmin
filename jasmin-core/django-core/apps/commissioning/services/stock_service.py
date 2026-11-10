from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, time
from decimal import Decimal
from typing import TypeAlias

from django.db.models import Q
from django.utils import timezone
from django.utils.timezone import make_aware

from ..models import CurrentStockBalance, MovementShareArticle, StockSnapshot
from ..models.choices import MovementTypeOptions
from ..utils.iso_week_utils import week_day_to_date

# A stock query's scope: per entity field, one value or several (the
# collections ``_build_base_filter`` expands into an ``__in``).
EntityFilter: TypeAlias = Mapping[str, str | list[str] | set[str] | tuple[str, ...]]


def _build_base_filter(
    storage: str | None,
    entity_filter: EntityFilter | None,
) -> Q:
    """Build a reusable Q filter from optional storage / entity constraints.

    An ``entity_filter`` value may be a scalar (exact match) OR a list/set/tuple
    (``__in`` match) — the latter lets a caller scope a stock query to several
    articles at once (e.g. a season-wide recompute scoping the snapshot to just
    the articles it is rebuilding instead of the whole ledger).
    """
    q = Q()
    if storage:
        q &= Q(storage=storage)
    if entity_filter:
        for field in ("share_article_id", "unit", "size"):
            if field in entity_filter:
                value = entity_filter[field]
                if isinstance(value, (list, set, tuple)):
                    q &= Q(**{f"{field}__in": list(value)})
                else:
                    q &= Q(**{field: value})
    return q


def _entity_key(
    share_article_id: str,
    unit: str | None,
    size: str | None,
    storage_id: str | None,
) -> tuple[str, str | None, str | None, str | None]:
    """Normalise an entity key (coerce falsy storage_id to None)."""
    return (str(share_article_id), unit, size, str(storage_id) if storage_id else None)


def _days_inventory_map(
    target_dt_start: datetime,
    target_dt_end: datetime,
    base_filter: Q,
) -> dict[tuple, dict]:
    """Aggregate the target day's INVENTORY movements per entity.

    Carries ``amount`` as Decimal internally so the running-balance math
    stays exact; callers convert to float only at the dict-build boundary
    where the result feeds into JSON responses.
    """
    inventory_qs = (
        MovementShareArticle.objects.filter(
            movement_type=MovementTypeOptions.INVENTORY,
            date__gte=target_dt_start,
            date__lte=target_dt_end,
        )
        .filter(base_filter)
        .select_related("share_article")
    )

    inventory_map: dict[tuple, dict] = {}
    for movement in inventory_qs.order_by("date"):
        key = _entity_key(
            movement.share_article_id,
            movement.unit,
            movement.size,
            movement.storage_id,
        )
        prior_amount = (inventory_map.get(key) or {}).get("amount") or Decimal("0")
        inventory_map[key] = {
            # Sum ALL of the day's INVENTORY corrections for this entity so
            # the theoretical baseline subtracts every same-day correction,
            # not just the last. Display fields keep the last row's.
            "amount": prior_amount + movement.amount,
            # ``counted_amount IS NULL`` marks a metadata-only row (flags/note
            # toggled, no count) — the read path must not treat it as a count.
            # Keep the last row's, like the display fields.
            "counted_amount": movement.counted_amount,
            "is_finalized": movement.is_finalized,
            "washed": movement.washed,
            "cleaned": movement.cleaned,
            "for_shares": movement.for_shares,
            "for_resellers": movement.for_resellers,
            "for_markets": movement.for_markets,
            "note": movement.note or "",
            "id": movement.id,
        }
    return inventory_map


def _build_result_row(
    running_balance: Decimal,
    inventory_row: dict,
    has_inventory: bool,
) -> dict:
    """Assemble one result-dict entry from the entity's running balance and
    its (possibly empty) day-INVENTORY data."""
    inventory_delta = inventory_row.get("amount") or Decimal("0")  # Decimal

    # theoretical = balance without today's INVENTORY correction
    theoretical = running_balance - inventory_delta  # Decimal
    # A metadata-only INVENTORY row has ``counted_amount IS
    # NULL``: it toggles flags/note but leaves the stock uncounted, so it must NOT
    # report a phantom count = theoretical. Gate the counted value on an ACTUAL
    # count. ``is_finalized`` and the flags/note stay on row presence
    # (``has_inventory``) so a finalized-but-uncounted row still reports its real
    # finalized state and a fresh flags-only row reads False (entry, not counted),
    # not None (no entry). ``counted`` = balance including the correction.
    has_count = has_inventory and inventory_row.get("counted_amount") is not None
    counted = running_balance if has_count else None  # Decimal | None

    return {
        # Convert to float at the JSON boundary so the wire shape
        # stays unchanged (DRF's default Decimal-to-string would
        # break the frontend's number-typed parsing).
        "theoretical_current_stock": float(theoretical),
        "current_stock_amount": float(counted) if counted is not None else None,
        "is_finalized": inventory_row.get("is_finalized") if has_inventory else None,
        "washed": inventory_row.get("washed") if has_inventory else None,
        "cleaned": inventory_row.get("cleaned") if has_inventory else None,
        "for_shares": inventory_row.get("for_shares") if has_inventory else None,
        "for_resellers": inventory_row.get("for_resellers") if has_inventory else None,
        "for_markets": inventory_row.get("for_markets") if has_inventory else None,
        "note": inventory_row.get("note", "") if has_inventory else "",
    }


def _known_balances(
    target_dt_end: datetime, base_filter: Q
) -> dict[tuple, tuple[Decimal, datetime]]:
    """Each entity's latest known balance up to ``target_dt_end``, with its
    moment: its latest snapshot or its latest count, whichever is later.

    A count's ``counted_amount`` is the balance at the count, which no change
    of the movements before it moves (the cascade re-derives the count's
    delta to keep it). It serves where the count has no snapshot of its own,
    as after an entry: the entry's cascade starts at the count and drops the
    snapshot the entry made there.
    """
    balances: dict[tuple, tuple[Decimal, datetime]] = {}
    snapshots = (
        StockSnapshot.objects.filter(Q(snapshot_date__lte=target_dt_end) & base_filter)
        .order_by("-snapshot_date")
        .values_list(
            "share_article_id", "unit", "size", "storage_id", "balance", "snapshot_date"
        )
    )
    counts = (
        MovementShareArticle.objects.filter(
            Q(date__lte=target_dt_end) & base_filter,
            movement_type=MovementTypeOptions.INVENTORY,
            counted_amount__isnull=False,
        )
        .order_by("-date")
        .values_list(
            "share_article_id", "unit", "size", "storage_id", "counted_amount", "date"
        )
    )
    # Latest first within each source, so only a later moment of the other
    # source replaces an entity's first entry.
    for rows in (snapshots, counts):
        for share_article_id, unit, size, storage_id, balance, moment in rows:
            # ``counted_amount`` may be NULL in the model; the count query
            # leaves those rows out, and the check says so to the type checker.
            if balance is None:
                continue
            key = _entity_key(share_article_id, unit, size, storage_id)
            if key not in balances or moment > balances[key][1]:
                balances[key] = (balance, moment)
    return balances


def _day_window(
    year: int, delivery_week: int, day_number: int | str
) -> tuple[datetime, datetime]:
    """The first and the last second of a delivery day, in the current time
    zone."""
    target_date = week_day_to_date(year, delivery_week, int(day_number))
    return (
        make_aware(datetime.combine(target_date, time(0, 0, 0))),
        make_aware(datetime.combine(target_date, time(23, 59, 59))),
    )


class StockService:
    @staticmethod
    def get_theoretical_current_stock(
        year: int,
        delivery_week: int,
        day_number: int | str,
        storage: str | None = None,
        entity_filter: EntityFilter | None = None,
    ) -> dict[tuple, dict]:
        """
        Calculate theoretical current stock and compare with inventory counts.

        Theoretical stock = sum of ALL movements (incl. INVENTORY) up to end of
        the target day_number.

        For target_date == today, reads from the maintained ``CurrentStockBalance``
        projection (O(N) lookup). For historical or future-dated queries, falls
        back to each entity's latest snapshot or count and the movements after
        it (``_known_balances``).

        Inventory count = the most recent INVENTORY movement for each entity
        on the target day_number.

        Returns a dict keyed by (share_article_id, unit, size, storage_id) with:
        - theoretical_current_stock: running balance from snapshots + movements
        - current_stock_amount: amount of today's INVENTORY movement (or None)
        - is_finalized, washed, cleaned, for_shares, for_resellers, for_markets
        """
        target_dt_start, target_dt_end = _day_window(year, delivery_week, day_number)
        if target_dt_start.date() == timezone.localdate():
            return StockService._current_stock_from_projection(
                target_dt_start, target_dt_end, storage, entity_filter
            )
        return StockService._current_stock_from_known_balances(
            target_dt_start, target_dt_end, storage, entity_filter
        )

    @staticmethod
    def get_current_stock_without_projection(
        year: int,
        delivery_week: int,
        day_number: int | str,
        entity_filter: EntityFilter | None = None,
    ) -> dict[tuple, dict]:
        """``get_theoretical_current_stock``'s result for any day from each
        entity's latest snapshot or count and the movements after it, never
        from the ``CurrentStockBalance`` projection.

        For a caller that has changed movements in its own transaction and
        deferred their snapshot cascade, as a recompute does before it
        allocates the new movements: the projection then still counts the
        deleted movements and lacks the new ones, and a count's correction
        delta (its ``amount``) still answers the old balance. The count itself
        holds, and the movements after it are read as they are.
        """
        target_dt_start, target_dt_end = _day_window(year, delivery_week, day_number)
        return StockService._current_stock_from_known_balances(
            target_dt_start, target_dt_end, None, entity_filter
        )

    @staticmethod
    def _current_stock_from_known_balances(
        target_dt_start: datetime,
        target_dt_end: datetime,
        storage: str | None,
        entity_filter: EntityFilter | None,
    ) -> dict[tuple, dict]:
        """Each entity's running balance at the end of the day: its latest
        known balance up to then (``_known_balances``), plus the movements
        after it."""
        base_filter = _build_base_filter(storage, entity_filter)

        # ── Step 1: today's INVENTORY movements ─
        inventory_map = _days_inventory_map(target_dt_start, target_dt_end, base_filter)

        # ── Step 2: compute running balance per entity ─────────────
        # Known balances (snapshots and counts) as baselines where available; a
        # snapshot carries the entity fields under the movement's names, so the
        # scope applies to it.
        baselines = _known_balances(target_dt_end, base_filter)

        # Query movements, respecting per-entity snapshot cutoffs
        all_movements = list(
            MovementShareArticle.objects.filter(
                Q(date__lte=target_dt_end) & base_filter
            ).values_list(
                "share_article_id", "unit", "size", "storage_id", "date", "amount"
            )
        )

        # Collect all entity keys
        all_entity_keys: set[tuple] = set(inventory_map) | set(baselines)
        for share_article_id, unit, size, storage_id, _, _ in all_movements:
            all_entity_keys.add(_entity_key(share_article_id, unit, size, storage_id))

        # Sum movements per entity
        movement_sums: dict[tuple, Decimal] = {}
        for (
            share_article_id,
            unit,
            size,
            storage_id,
            movement_date,
            movement_amount,
        ) in all_movements:
            if movement_amount == 0:
                continue

            key = _entity_key(share_article_id, unit, size, storage_id)

            # Skip movements that predate this entity's known balance
            if key in baselines:
                _, baseline_moment = baselines[key]
                if movement_date <= baseline_moment:
                    continue

            movement_sums[key] = movement_sums.get(key, Decimal("0")) + movement_amount

        # ── Step 3: calculate final results ────────────────────────
        result: dict[tuple, dict] = {}

        for key in all_entity_keys:
            baseline = baselines.get(key, (Decimal("0"), None))[0]
            movements = movement_sums.get(key, Decimal("0"))
            running_balance = baseline + movements  # Decimal

            result[key] = _build_result_row(
                running_balance,
                inventory_map.get(key, {}),
                has_inventory=key in inventory_map,
            )

        return result

    @staticmethod
    def _current_stock_from_projection(
        target_dt_start: datetime,
        target_dt_end: datetime,
        storage: str | None,
        entity_filter: EntityFilter | None,
    ) -> dict[tuple, dict]:
        """Fast path for ``target_date == today``.

        Reads the maintained ``CurrentStockBalance`` projection (one row per
        entity, updated transactionally with every movement change). Inventories
        on the target day are still fetched from MovementShareArticle to expose
        the per-entity ``is_finalized``/``washed``/etc. flags.
        """
        base_filter = _build_base_filter(storage, entity_filter)

        # Today's INVENTORY rows — same as slow path step 1
        inventory_map = _days_inventory_map(target_dt_start, target_dt_end, base_filter)

        # Maintained balances — one indexed lookup per entity, no aggregation.
        # CurrentStockBalance shares the entity field names with
        # MovementShareArticle, so the same base filter applies directly.
        balance_qs = CurrentStockBalance.objects.filter(base_filter)

        balances: dict[tuple, Decimal] = {
            _entity_key(b.share_article_id, b.unit, b.size, b.storage_id): b.balance
            for b in balance_qs
        }

        # The projection counts every movement on record (no date filter — see
        # SnapshotService.compute_balance). For "today" queries we want the
        # balance *at end of today*, so subtract any movements strictly after
        # target_dt_end (e.g. an INVENTORY scheduled for tomorrow).
        future_sums: dict[tuple, Decimal] = {}
        future_qs = (
            MovementShareArticle.objects.filter(date__gt=target_dt_end)
            .filter(base_filter)
            .values_list("share_article_id", "unit", "size", "storage_id", "amount")
        )
        for share_article_id, unit, size, storage_id, amount in future_qs:
            key = _entity_key(share_article_id, unit, size, storage_id)
            future_sums[key] = future_sums.get(key, Decimal("0")) + amount

        # Entities to emit: union of balances and today's inventories
        all_keys = set(balances) | set(inventory_map)

        result: dict[tuple, dict] = {}
        for key in all_keys:
            raw_balance = balances.get(key, Decimal("0"))
            future = future_sums.get(key, Decimal("0"))
            running_balance = raw_balance - future  # Decimal

            result[key] = _build_result_row(
                running_balance,
                inventory_map.get(key, {}),
                has_inventory=key in inventory_map,
            )
        return result
