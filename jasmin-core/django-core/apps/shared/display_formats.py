"""Dates, times and amounts written the way the tenant's app shows them.

Text the server writes for people — emails above all — uses the tenant's own
display settings, so a date or a total reads the same in an email as on the
page it links to and in the PDF it carries:

- ``date_format`` and ``time_format`` hold dayjs tokens, the frontend's
  formats (``DD.MM.YYYY``, ``hh:mm A``, …);
- ``number_locale`` is the BCP-47 tag the frontend hands to
  ``Intl.NumberFormat``;
- ``currency`` is an ISO 4217 code, printed as the frontend's
  ``utils/currency.ts`` prints it.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, fields
from decimal import Decimal
from typing import Any

from django.utils import timezone

from apps.shared.money import round_money

# ``[escaped text]``, or a run of one letter — dayjs reads ``MMM`` as one token
# (a month name), not as ``MM`` followed by ``M``.
_TOKEN = re.compile(r"\[([^\]]*)]|([A-Za-z])\2*")

# (grouping, decimal mark) the way Intl.NumberFormat writes them. A tag that
# isn't listed goes by its language, and an unknown language by German.
_SEPARATORS = {
    "de": (".", ","),
    "de-CH": ("’", "."),
    "en": (",", "."),
    "fr": (" ", ","),
}

# A code without a symbol prints as itself, after the amount like the euro.
_CURRENCY_SYMBOLS = {"EUR": "€", "USD": "$", "GBP": "£", "CHF": "CHF"}
_PREFIX_SYMBOLS = {"$", "£"}


def _date_tokens(day: dt.date) -> dict[str, str]:
    return {
        "YYYY": f"{day.year:04d}",
        "YY": f"{day.year % 100:02d}",
        "MM": f"{day.month:02d}",
        "M": str(day.month),
        "DD": f"{day.day:02d}",
        "D": str(day.day),
    }


def _time_tokens(moment: dt.datetime) -> dict[str, str]:
    hour12 = moment.hour % 12 or 12
    return {
        "HH": f"{moment.hour:02d}",
        "H": str(moment.hour),
        "hh": f"{hour12:02d}",
        "h": str(hour12),
        "mm": f"{moment.minute:02d}",
        "m": str(moment.minute),
        "ss": f"{moment.second:02d}",
        "s": str(moment.second),
        "A": "AM" if moment.hour < 12 else "PM",
        "a": "am" if moment.hour < 12 else "pm",
    }


def _render(pattern: str, tokens: dict[str, str]) -> str | None:
    """``pattern`` with each token replaced, or None when it uses a token
    ``tokens`` lacks — the caller falls back to the default format rather than
    print the token as text."""
    rendered = []
    end = 0
    for match in _TOKEN.finditer(pattern):
        rendered.append(pattern[end : match.start()])
        if match.group(1) is not None:
            rendered.append(match.group(1))
        elif match.group(0) in tokens:
            rendered.append(tokens[match.group(0)])
        else:
            return None
        end = match.end()
    rendered.append(pattern[end:])
    return "".join(rendered)


@dataclass(frozen=True)
class DisplayFormats:
    date_format: str = "DD.MM.YYYY"
    time_format: str = "HH:mm"
    number_locale: str = "de-DE"
    currency: str = "EUR"

    @classmethod
    def of(cls, tenant: Any) -> DisplayFormats:
        """The formats ``tenant`` set, and the defaults where it set none."""
        chosen = {
            field.name: value
            for field in fields(cls)
            if isinstance(value := getattr(tenant, field.name, None), str) and value
        }
        return cls(**chosen)

    @classmethod
    def current(cls) -> DisplayFormats:
        """The formats of the tenant the connection is on.

        A request carries the tenant itself. Under ``schema_context`` — Huey
        workers, management commands — the connection holds only the schema
        name, so the tenant is looked up by it.
        """
        from apps.shared.tenants.models import Tenant
        from core.tenant_db import connection

        tenant = connection.tenant
        if not isinstance(tenant, Tenant):
            tenant = Tenant.objects.filter(schema_name=connection.schema_name).first()
        return cls() if tenant is None else cls.of(tenant)

    def format_date(self, value: dt.date | None) -> str:
        """``value`` in the tenant's date format, e.g. ``31.12.2026``."""
        if value is None:
            return ""
        if isinstance(value, dt.datetime) and timezone.is_aware(value):
            value = timezone.localtime(value)
        tokens = _date_tokens(value)
        rendered = _render(self.date_format, tokens)
        if rendered is None:
            rendered = _render(DisplayFormats().date_format, tokens)
        return rendered or ""

    def format_datetime(self, value: dt.datetime | None) -> str:
        """``value`` in the tenant's date and time formats, e.g.
        ``31.12.2026, 23:59`` — in the server's time zone, the one the
        backend's ``timezone.localdate()`` uses."""
        if value is None:
            return ""
        moment = timezone.localtime(value) if timezone.is_aware(value) else value
        tokens = _time_tokens(moment)
        time_of_day = _render(self.time_format, tokens)
        if time_of_day is None:
            time_of_day = _render(DisplayFormats().time_format, tokens)
        return f"{self.format_date(moment)}, {time_of_day}"

    def format_money(self, amount: Decimal | float | int | str | None) -> str:
        """``amount`` in whole cents with the tenant's separators and currency,
        e.g. ``1.234,56 €`` or ``$1,234.56``."""
        if amount is None or amount == "":
            return ""
        language = self.number_locale.split("-")[0]
        grouping, decimal_mark = _SEPARATORS.get(
            self.number_locale, _SEPARATORS.get(language, _SEPARATORS["de"])
        )
        number = f"{round_money(amount):,.2f}".translate(
            {ord(","): grouping, ord("."): decimal_mark}
        )
        symbol = _CURRENCY_SYMBOLS.get(self.currency, self.currency)
        if symbol in _PREFIX_SYMBOLS:
            return f"{symbol}{number}"
        return f"{number} {symbol}"
