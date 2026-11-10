"""The app's database sessions carry the limits ``DATABASES`` sets."""

import pytest
from django.db import connection


@pytest.mark.django_db
def test_a_session_idle_in_a_transaction_is_ended_after_five_minutes():
    with connection.cursor() as cursor:
        cursor.execute("SHOW idle_in_transaction_session_timeout")
        (timeout,) = cursor.fetchone()

    assert timeout == "5min"
