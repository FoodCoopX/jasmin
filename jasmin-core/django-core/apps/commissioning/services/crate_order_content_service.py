from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.db.models import Q, QuerySet

from core.db_locks import acquire_advisory_xact_lock

from ..constants import crates_should_be_on_documents
from ..errors import CrateNotFound, CratesDisabledOnDocuments, FinalizedError
from ..models import Crate, CrateOrderContent, Order
from ..utils.iso_week_utils import week_day_to_date
from ..utils.tax_rate_utils import effective_crate_tax_rate
from .crate_content_service import CrateContentService
from .crate_lines import crate_line_rows, parse_crate_line_id
from .crate_summary import summarize_crate_items, summarize_crate_line


class CrateOrderContentService:
    # ──────────────────────────────────────────────
    # Private helpers
    # ──────────────────────────────────────────────

    @staticmethod
    def _period_filter(
        year: int,
        delivery_week: int,
        day_number: int,
        reseller,
    ) -> Q:
        """Build the base Q filter for order_content->order and direct order paths."""
        return Q(
            order_content__isnull=False,
            order_content__order__year=year,
            order_content__order__delivery_week=delivery_week,
            order_content__order__day_number=day_number,
            order_content__order__reseller=reseller,
        ) | Q(
            order__isnull=False,
            order__year=year,
            order__delivery_week=delivery_week,
            order__day_number=day_number,
            order__reseller=reseller,
        )

    @staticmethod
    def _slot_order(
        year: int,
        delivery_week: int,
        day_number: int,
        reseller,
    ) -> Order | None:
        """The reseller's order for a delivery day; there is at most one."""
        return Order.objects.filter(
            reseller=reseller,
            year=year,
            delivery_week=delivery_week,
            day_number=day_number,
        ).first()

    @staticmethod
    def _lock_crate_type(order_pk: str, crate_type_id: str) -> str:
        """Take the per-(order, crate type) lock that writes to an order's crate
        lines serialise on, and return its key."""
        lock_key = f"crate_totals:Order:{order_pk}:{crate_type_id}"
        acquire_advisory_xact_lock(lock_key)
        return lock_key

    @staticmethod
    def _line_summary(
        period_q: Q, crate_type_id: str, row_pk: str | None
    ) -> dict[str, Any]:
        """The period's crate line that holds the row ``row_pk``, or for None the
        first line of the crate type the order list shows. {} when there is
        none."""
        rows = CrateOrderContent.objects.filter(
            period_q, crate_type_id=crate_type_id
        ).select_related("crate_type")
        if row_pk is not None:
            return summarize_crate_line(rows, row_pk) or {}
        shown = (line for line in summarize_crate_items(rows) if line["amount"] > 0)
        return next(shown, {})

    @staticmethod
    def _take_off_line(line_pks: list[str], row_pk: str | None, new_total: int) -> None:
        """Lower the crate line made of the rows ``line_pks`` to ``new_total``.

        The crates come off the rows added directly to the order first, then
        off the offer-bound rows, which their order line rebuilds whenever it
        is saved, so a reduction taken there lasts until then. Within each kind
        the row ``row_pk`` goes last and keeps a crate unless the line goes to
        zero: the line is named by that row, and a write naming a line whose
        row is gone answers 409 ``crate_line.changed``. No row goes below zero,
        and a row brought to zero is deleted.
        """
        rows = list(
            CrateOrderContent.objects.select_for_update().filter(pk__in=line_pks)
        )
        excess = sum(row.amount for row in rows) - new_total
        rows.sort(
            key=lambda row: (row.order_id is None, str(row.pk) == row_pk, str(row.pk))
        )
        for row in rows:
            keep = min(1, new_total) if str(row.pk) == row_pk else 0
            taken = min(excess, max(row.amount - keep, 0))
            if taken <= 0:
                continue
            excess -= taken
            row.amount -= taken
            if row.amount:
                row.save(update_fields=["amount"])
            else:
                row.delete()

    @staticmethod
    def _write_line(
        order: Order,
        line: list[CrateOrderContent],
        row_pk: str | None,
        update_data: dict,
        lock_key: str,
    ) -> None:
        """Write ``update_data`` onto the rows of one crate line of ``order``.

        The amount is the line's new total. Offer-bound rows are rebuilt from
        their order line whenever it is saved, so an increase lands on a row
        added directly to the order: another of the line's direct rows, else a
        new one, while a line of one direct row takes it itself. A reduction
        comes off the line's own rows instead (``_take_off_line``): a row added
        to hold it would be negative, and would outlive the offer-bound rows it
        offsets once their order line is deleted, as a crate credit on the
        order's delivery note. The price, rabatt and note go on every row of
        the line, the note on its own because a row added for an increase
        carries the service's ``+N`` note.
        """
        line_pks = [row.pk for row in line]
        update_fields = {
            field: update_data[field]
            for field in ("price_per_unit", "rabatt")
            if field in update_data
        }
        if update_fields:
            CrateOrderContent.objects.filter(pk__in=line_pks).update(**update_fields)
        current_total = sum(row.amount for row in line)
        new_total = update_data.get("amount", current_total)
        if new_total < current_total:
            CrateOrderContentService._take_off_line(line_pks, row_pk, new_total)
        elif new_total > current_total:
            direct = [row.pk for row in line if row.order_id and row.pk != row_pk]
            # None makes the service adjust the scope itself, an empty queryset
            # makes it add a row.
            adjustment_qs: QuerySet[CrateOrderContent] | None
            if direct:
                adjustment_qs = CrateOrderContent.objects.filter(pk__in=direct)
            elif len(line) == 1 and line[0].order_id:
                adjustment_qs = None
            else:
                adjustment_qs = CrateOrderContent.objects.none()
            CrateContentService.apply_total_amount_change(
                scope_qs=CrateOrderContent.objects.filter(pk__in=line_pks),
                adjustment_qs=adjustment_qs,
                new_total_amount=new_total,
                # The line's rows carry the new price and rabatt already; a row
                # added for the increase takes them from create_kwargs.
                update_fields={},
                create_kwargs={
                    "order": order,
                    "crate_type_id": line[0].crate_type_id,
                    "price_per_unit": line[0].price_per_unit,
                    "rabatt": line[0].rabatt,
                    "tax_rate": line[0].tax_rate,
                    **update_fields,
                },
                model_class=CrateOrderContent,
                lock_key=lock_key,
            )
        if "note" in update_data:
            CrateOrderContent.objects.filter(pk__in=line_pks).update(
                note=update_data["note"]
            )

    # ──────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────

    @staticmethod
    def get_crates_summary_for_period(
        year: int,
        delivery_week: int,
        day_number: int,
        reseller,
    ) -> list[dict[str, Any]]:
        """Get aggregated crate summary for a specific period and reseller.

        Groups by (crate_type, price_per_unit, rabatt, tax_rate) via
        ``summarize_crate_items`` so the displayed price / rabatt / tax_rate are
        the exact per-group values and ``line_netto`` is the SUM of the grouped
        rows' per-row nets — matching the delivery-note / invoice crate summary,
        rather than a lossy ``max()`` aggregate that misrepresents a crate type
        whose lines mix prices / rates.
        """
        filter_q = CrateOrderContentService._period_filter(
            year, delivery_week, day_number, reseller
        )

        rows = CrateOrderContent.objects.filter(filter_q).select_related("crate_type")

        summary = summarize_crate_items(rows)
        # Hide fully-returned / net-zero crate groups.
        return [row for row in summary if row["amount"] > 0]

    @staticmethod
    @transaction.atomic
    def create_crate_order_content(
        crate_type_id,
        amount: Decimal,
        year: int,
        delivery_week: int,
        day_number: int,
        reseller,
        price_per_unit: Decimal | None = None,
        rabatt: int | None = None,
        note: str | None = None,
        **kwargs,
    ) -> dict[str, Any]:
        """Create a new crate order content record, finding or creating the Order."""
        if not crates_should_be_on_documents():
            raise CratesDisabledOnDocuments(
                "Crates are disabled on documents for this tenant."
            )
        order, _created = Order.objects.get_or_create(
            reseller_id=reseller,
            year=year,
            delivery_week=delivery_week,
            day_number=day_number,
            defaults={"created_by": kwargs.pop("created_by", None)},
        )
        # Lock the order row to serialize concurrent crate additions
        order = Order.objects.select_for_update().get(pk=order.pk)

        pricing_date = week_day_to_date(year, delivery_week, day_number)
        try:
            crate = Crate.objects.get(id=crate_type_id)
        except Crate.DoesNotExist as exc:
            raise CrateNotFound(
                f"Crate {crate_type_id!r} does not exist",
                details={"id": str(crate_type_id)},
            ) from exc
        pricing = crate.get_pricing_on_date(pricing_date)
        # Distinguish "not provided" (None) from an explicit 0 — a money
        # field must not treat a legitimate zero-deposit crate as unset. Mirrors
        # the `is None` tax_rate check below; `not Decimal("0")` is True and would
        # silently overwrite an intentional 0 with the dated pricing.
        if price_per_unit is None and pricing:
            price_per_unit = pricing.price

        # tax_rate is NOT NULL — resolve from crate pricing or tenant default
        # when the caller didn't pass an explicit value.
        if kwargs.get("tax_rate") is None:
            kwargs["tax_rate"] = effective_crate_tax_rate(crate, pricing_date)

        crate_order_content = CrateOrderContent.objects.create(
            order=order,
            crate_type_id=crate_type_id,
            amount=amount,
            price_per_unit=price_per_unit,
            rabatt=rabatt,
            note=note,
            **kwargs,
        )

        # The crate line the new row joins, named as the order list names it.
        result = CrateOrderContentService._line_summary(
            Q(order=order) | Q(order_content__order=order),
            crate_type_id,
            crate_order_content.pk,
        )
        result["note"] = crate_order_content.note
        result["order_id"] = order.id
        # Mirror the OrderContent path (_serialize_order_metadata) and the
        # refresh metadata block: the frontend formats the order number as
        # "{prefix}-{display_number}" and seeds those two fields identically
        # from the create response and from a reload. A crates-first save must
        # therefore carry display_number (e.g. "39v") + prefix — not the raw
        # number (which showed "39" instead of "39v") and not a missing prefix
        # (which rendered "undefined-39" until the next reload).
        result["order_number"] = order.display_number
        result["order_number_prefix"] = order.prefix
        return result

    @staticmethod
    @transaction.atomic
    def update_crate_order_content_line(
        line_id: str,
        year: int,
        delivery_week: int,
        day_number: int,
        reseller: str,
        update_data: dict,
    ) -> dict[str, Any]:
        """Write ``update_data`` onto the crate line ``line_id`` names on the
        reseller's order for the period, every line of the crate type for a bare
        crate type id, and return that line ({} when none is left to show).

        A line id whose named row is gone answers 409 ``crate_line.changed``
        while the order holds other crates of the type; a type the order holds
        no crates of answers 404.
        """
        if not crates_should_be_on_documents():
            raise CratesDisabledOnDocuments(
                "Crates are disabled on documents for this tenant."
            )
        parsed = parse_crate_line_id(line_id)
        order = CrateOrderContentService._slot_order(
            year, delivery_week, day_number, reseller
        )
        if order is None:
            raise CrateOrderContent.DoesNotExist(
                "No CrateOrderContent found for the given crate type and period."
            )
        if order.is_finalized:
            raise FinalizedError("Cannot modify the crates of a finalized order.")
        lock_key = CrateOrderContentService._lock_crate_type(
            order.pk, parsed.crate_type_id
        )
        period_q = CrateOrderContentService._period_filter(
            year, delivery_week, day_number, reseller
        )
        line = crate_line_rows(
            CrateOrderContent.objects.filter(
                period_q, crate_type_id=parsed.crate_type_id
            ),
            parsed,
        )
        if not line:
            raise CrateOrderContent.DoesNotExist(
                "No CrateOrderContent found for the given crate type and period."
            )
        CrateOrderContentService._write_line(
            order, line, parsed.row_pk, update_data, lock_key
        )
        return CrateOrderContentService._line_summary(
            period_q, parsed.crate_type_id, parsed.row_pk
        )

    @staticmethod
    @transaction.atomic
    def delete_crate_order_content_line(
        line_id: str,
        year: int | None = None,
        delivery_week: int | None = None,
        day_number: int | None = None,
        reseller: str | None = None,
        order_id: str | None = None,
        scope: Callable[[QuerySet], QuerySet] | None = None,
    ) -> bool:
        """Delete the crate line ``line_id`` names within an order context,
        every line of the crate type for a bare crate type id.

        With ``order_id`` only the rows added directly to that order go: an
        offer-bound row is rebuilt from its order line. The period branch
        deletes every row of the line. The line is found among the period's
        rows of the crate type, or the order's when no period is given, under
        the lock the order's crate line writes take.

        ``scope`` is an optional queryset transform the caller supplies to bind
        the otherwise reseller-blind ``order_id`` branch to an authorization
        boundary — e.g. ``scope_to_reseller(qs, request, path="order__reseller")``
        — so an ``order_id``-keyed delete can never reach another reseller's
        content (cross-reseller IDOR guard). It is applied ONLY to the
        ``order_id`` branch; the period branch is already reseller-scoped by
        ``_period_filter`` (which covers both the ``order`` and
        ``order_content`` linkage paths) so re-scoping it would wrongly skip
        ``order_content``-linked rows.
        """
        parsed = parse_crate_line_id(line_id)
        slot_order = None
        if year and delivery_week and day_number is not None and reseller:
            context_q = CrateOrderContentService._period_filter(
                year, delivery_week, day_number, reseller
            )
            if not order_id:
                slot_order = CrateOrderContentService._slot_order(
                    year, delivery_week, day_number, reseller
                )
        elif order_id:
            context_q = Q(order_id=order_id) | Q(order_content__order_id=order_id)
        else:
            return False
        lock_order_pk = order_id or (slot_order.pk if slot_order else None)
        if lock_order_pk is None:
            return False
        CrateOrderContentService._lock_crate_type(lock_order_pk, parsed.crate_type_id)
        type_rows = CrateOrderContent.objects.filter(
            context_q, crate_type_id=parsed.crate_type_id
        )
        qs = type_rows
        if order_id:
            qs = CrateOrderContent.objects.filter(
                crate_type_id=parsed.crate_type_id, order_id=order_id
            )
            if scope is not None:
                qs = scope(qs)
        if parsed.row_pk is not None:
            line = crate_line_rows(type_rows, parsed)
            qs = qs.filter(pk__in=[row.pk for row in line])

        deleted_count, _ = qs.delete()
        return deleted_count > 0
