"""``DisplayFormats``: dates, times and amounts written with the tenant's own
display settings — the dayjs formats, number locale and currency the frontend
formats with.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest
from django_tenants.utils import schema_context

from apps.shared.display_formats import DisplayFormats
from apps.shared.tenants.models import Tenant

DAY = dt.date(2025, 3, 7)
AFTERNOON = dt.datetime(2025, 3, 7, 14, 5, 9)


class TestDates:
    @pytest.mark.parametrize(
        "date_format, expected",
        [
            # The four the settings page offers.
            ("DD.MM.YYYY", "07.03.2025"),
            ("DD/MM/YYYY", "07/03/2025"),
            ("YYYY-MM-DD", "2025-03-07"),
            ("MM-DD-YYYY", "03-07-2025"),
            ("D.M.YY", "7.3.25"),
            ("[am] DD.MM.", "am 07.03."),
        ],
    )
    def test_the_tenants_format(self, date_format, expected):
        assert DisplayFormats(date_format=date_format).format_date(DAY) == expected

    def test_a_token_it_cannot_write_falls_back_to_the_default(self):
        # ``MMM`` is a month name in dayjs, not ``MM`` followed by ``M``.
        formats = DisplayFormats(date_format="D MMM YYYY")

        assert formats.format_date(DAY) == "07.03.2025"

    def test_an_aware_datetime_is_dated_in_the_servers_time_zone(self, settings):
        settings.TIME_ZONE = "Europe/Berlin"
        half_past_eleven_utc = dt.datetime(2025, 3, 7, 23, 30, tzinfo=dt.UTC)

        assert DisplayFormats().format_date(half_past_eleven_utc) == "08.03.2025"

    def test_no_date_is_empty(self):
        assert DisplayFormats().format_date(None) == ""


class TestDatetimes:
    @pytest.mark.parametrize(
        "time_format, expected",
        [
            ("HH:mm", "07.03.2025, 14:05"),
            ("HH:mm:ss", "07.03.2025, 14:05:09"),
            ("hh:mm A", "07.03.2025, 02:05 PM"),
            ("h:mm A", "07.03.2025, 2:05 PM"),
        ],
    )
    def test_the_tenants_time_format(self, time_format, expected):
        formats = DisplayFormats(time_format=time_format)

        assert formats.format_datetime(AFTERNOON) == expected

    def test_midnight_and_noon_on_a_twelve_hour_clock(self):
        formats = DisplayFormats(date_format="MM-DD-YYYY", time_format="h:mm a")

        assert formats.format_datetime(dt.datetime(2025, 3, 7, 0, 0)) == (
            "03-07-2025, 12:00 am"
        )
        assert formats.format_datetime(dt.datetime(2025, 3, 7, 12, 0)) == (
            "03-07-2025, 12:00 pm"
        )

    def test_an_aware_time_is_written_in_the_servers_time_zone(self, settings):
        settings.TIME_ZONE = "Europe/Berlin"
        one_minute_to_midnight = dt.datetime(2025, 12, 31, 22, 59, tzinfo=dt.UTC)

        assert DisplayFormats().format_datetime(one_minute_to_midnight) == (
            "31.12.2025, 23:59"
        )

    def test_a_token_it_cannot_write_falls_back_to_the_default(self):
        formats = DisplayFormats(time_format="HH:mm Z")

        assert formats.format_datetime(AFTERNOON) == "07.03.2025, 14:05"

    def test_no_time_is_empty(self):
        assert DisplayFormats().format_datetime(None) == ""


class TestMoney:
    @pytest.mark.parametrize(
        "number_locale, expected",
        [
            # The four the settings page offers.
            ("de-DE", "1.234.567,50 €"),
            ("de-CH", "1’234’567.50 €"),
            ("en-US", "1,234,567.50 €"),
            ("fr-FR", "1 234 567,50 €"),
            # A tag that isn't listed goes by its language, an unknown
            # language by German.
            ("en-GB", "1,234,567.50 €"),
            ("it-IT", "1.234.567,50 €"),
        ],
    )
    def test_the_tenants_number_locale(self, number_locale, expected):
        formats = DisplayFormats(number_locale=number_locale)

        assert formats.format_money(Decimal("1234567.5")) == expected

    @pytest.mark.parametrize(
        "currency, expected",
        [
            ("EUR", "12,00 €"),
            ("CHF", "12,00 CHF"),
            ("USD", "$12,00"),
            ("GBP", "£12,00"),
            ("SEK", "12,00 SEK"),
        ],
    )
    def test_the_currency_on_its_side(self, currency, expected):
        assert DisplayFormats(currency=currency).format_money(12) == expected

    def test_rounds_half_up_to_whole_cents(self):
        formats = DisplayFormats()

        assert formats.format_money(Decimal("2.345")) == "2,35 €"
        assert formats.format_money(Decimal("-2.345")) == "-2,35 €"

    def test_a_float_keeps_its_decimal_value(self):
        assert DisplayFormats().format_money(0.1 + 0.2) == "0,30 €"

    @pytest.mark.parametrize("amount", [None, ""])
    def test_no_amount_is_empty(self, amount):
        assert DisplayFormats().format_money(amount) == ""


@pytest.mark.django_db
class TestTheTenantsFormats:
    def test_from_the_requests_tenant(self, tenant, monkeypatch):
        monkeypatch.setattr(tenant, "date_format", "YYYY-MM-DD")
        monkeypatch.setattr(tenant, "number_locale", "en-US")

        formats = DisplayFormats.current()

        assert formats.date_format == "YYYY-MM-DD"
        assert formats.number_locale == "en-US"

    def test_looked_up_by_schema_where_the_connection_holds_only_that(self, tenant):
        Tenant.objects.filter(pk=tenant.pk).update(
            date_format="MM-DD-YYYY", currency="CHF"
        )

        with schema_context(tenant.schema_name):
            formats = DisplayFormats.current()

        assert formats.date_format == "MM-DD-YYYY"
        assert formats.currency == "CHF"

    def test_a_setting_left_blank_takes_the_default(self):
        tenant = Tenant(date_format="", time_format="", number_locale="", currency="")

        assert DisplayFormats.of(tenant) == DisplayFormats()
