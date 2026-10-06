"""Discovery-level guard: state-machine fields must not be touched
via ``QuerySet.update(...)`` / ``bulk_update(...)``.

Why this exists
---------------

Two models in this codebase enforce invariants inside ``save()``
that get silently skipped when callers use ``.update(...)`` instead:

* **``JasminUser.account_status``** — ``save()`` derives ``is_active``
  from ``account_status`` ("single source of truth") and stamps
  ``activated_at`` / ``inactivated_at`` on transitions. Bypass via
  ``.update(account_status="active")`` leaves ``is_active`` stale
  and the audit timestamps null.
* **``Member.admin_confirmed`` / ``Subscription.admin_confirmed``** —
  ``AdminConfirmableMixin.confirm()`` calls ``_post_confirm()``,
  which for ``Member`` generates the public ``member_number`` (an
  advisory-locked sequence) and for ``Subscription``
  materialises shares + ShareDeliveries + ChargeSchedule. Bypass
  via ``.update(admin_confirmed=True)`` would leave a "confirmed"
  row with none of the downstream rows.

This guard keeps the bypass from being introduced silently.

How it works
------------

1. Walk every ``.py`` file under ``apps/`` (skipping ``tests/`` and
   ``migrations/``) and parse it.
2. Visit every call of a method named ``update`` or ``bulk_update``. An
   ``update`` writes the fields named by its keywords, including those of a
   ``**{...}`` literal; a ``bulk_update`` writes the string constants in its
   field list (the second argument, or ``fields=``). Working on the syntax
   tree, a call matches however black lays it out, and the name in a comment,
   a docstring or a ``filter(...)`` doesn't.
3. Skip a call that carries the opt-out marker — see "Opt-out" below.
4. Assert no remaining offenders, with file:line for each.

A field list held in a variable isn't resolved.

Opt-out
-------

A legitimate batch update of one of these fields (e.g. a one-off
data migration; a deliberate ``last_login_ip`` bulk stamp on a
list of users) can opt out with a trailing-comment marker on any line of
the call, from the method name to the closing parenthesis::

    JasminUser.objects.filter(
        account_status="pending_invitation"
    ).update(account_status="inactive")  # state-field-update-allowed: prod cleanup

The marker is a deliberate, greppable acknowledgement that the
caller knows the invariant is being skipped on purpose. The text
after the colon should explain *why* — the next reader will want
to know.
"""

from __future__ import annotations

import ast
from collections.abc import Iterable
from pathlib import Path

# Locate the django-core root (this test lives at
# ``apps/authz/tests/test_state_field_update_bypass_guard.py``).
_DJANGO_CORE_ROOT = Path(__file__).resolve().parents[3]
_APPS_DIR = _DJANGO_CORE_ROOT / "apps"

_SKIP_DIRS: tuple[str, ...] = ("tests", "migrations", "__pycache__")
_SELF_PATH = Path(__file__).resolve()

# Field names whose Python-side ``save()`` invariants must not be
# bypassed via bulk ``update()``. ``account_status`` drives
# ``is_active`` / ``activated_at`` / ``inactivated_at`` on JasminUser;
# ``admin_confirmed`` drives ``_post_confirm`` side-effects on
# AdminConfirmableMixin consumers (Member, Subscription, ...).
_PROTECTED_FIELDS: frozenset[str] = frozenset({"account_status", "admin_confirmed"})

_OPT_OUT_MARKER = "state-field-update-allowed"


def _string_constants(nodes: Iterable[ast.expr | None]) -> set[str]:
    return {
        node.value
        for node in nodes
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    }


def _fields_written(call: ast.Call, method: str) -> set[str]:
    """The fields an ``update(...)`` or ``bulk_update(...)`` call writes, as
    far as its source names them."""
    if method == "update":
        fields = {keyword.arg for keyword in call.keywords if keyword.arg}
        for keyword in call.keywords:
            # ``update(**{"field": value})``
            if keyword.arg is None and isinstance(keyword.value, ast.Dict):
                fields |= _string_constants(keyword.value.keys)
        return fields
    field_list = call.args[1] if len(call.args) > 1 else None
    for keyword in call.keywords:
        if keyword.arg == "fields":
            field_list = keyword.value
    if isinstance(field_list, ast.List | ast.Tuple | ast.Set):
        return _string_constants(field_list.elts)
    return set()


def _unmarked_writes(source: str) -> list[tuple[int, list[str]]]:
    """``(line, fields)`` for each ``update`` or ``bulk_update`` call in
    ``source`` that writes a protected field and carries no opt-out marker.
    The line is the method name's, where a reader looks for the call."""
    lines = source.splitlines()
    writes = []
    for node in ast.walk(ast.parse(source)):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in ("update", "bulk_update")
        ):
            continue
        protected = _fields_written(node, node.func.attr) & _PROTECTED_FIELDS
        if not protected:
            continue
        line_no = node.func.end_lineno or node.lineno
        if any(
            _OPT_OUT_MARKER in line for line in lines[line_no - 1 : node.end_lineno]
        ):
            continue
        writes.append((line_no, sorted(protected)))
    return writes


def _iter_python_files() -> list[Path]:
    out: list[Path] = []
    for path in _APPS_DIR.rglob("*.py"):
        if path.resolve() == _SELF_PATH:
            continue
        if any(part in _SKIP_DIRS for part in path.parts):
            continue
        out.append(path)
    return out


def test_no_state_field_update_bypass() -> None:
    """Protected state-machine fields (``account_status``,
    ``admin_confirmed``) must not be modified via ``QuerySet.update(...)``
    or ``bulk_update(...)``. Those paths skip ``save()``, which is where
    the cross-column invariants live (see
    ``apps/accounts/models.py:JasminUser.save`` and
    ``apps/commissioning/models/mixin.py:AdminConfirmableMixin.confirm``).

    Use ``instance.save()`` per row, or add the
    ``state-field-update-allowed: <reason>`` marker as a trailing
    comment on the call if the bypass is deliberate.
    """
    offenders = []
    for path in _iter_python_files():
        source = path.read_text(encoding="utf-8")
        # Cheap reject: most files don't touch these names at all.
        if not any(field in source for field in _PROTECTED_FIELDS):
            continue
        rel = path.relative_to(_DJANGO_CORE_ROOT)
        offenders += [
            f"{rel}:{line_no}  (field: {', '.join(fields)})"
            for line_no, fields in _unmarked_writes(source)
        ]

    assert not offenders, (
        "Found bulk-update calls that bypass save()-enforced invariants on "
        "state-machine fields. Use instance.save() per row, or add a trailing "
        "'state-field-update-allowed: <reason>' comment on the call if the "
        f"bypass is deliberate. {len(offenders)} hit(s):"
        "\n  - " + "\n  - ".join(sorted(offenders))
    )


class TestCallShapes:
    """Which calls count as writing a protected field."""

    def test_keywords_on_the_lines_after_the_call(self) -> None:
        source = "rows.update(\n    admin_confirmed=True,\n)\n"

        assert _unmarked_writes(source) == [(1, ["admin_confirmed"])]

    def test_a_chained_call_is_reported_on_its_update_line(self) -> None:
        source = "User.objects.filter(\n    pk=1\n).update(account_status='active')\n"

        assert _unmarked_writes(source) == [(3, ["account_status"])]

    def test_a_bulk_update_field_list(self) -> None:
        positional = 'Member.objects.bulk_update(rows, ["note", "admin_confirmed"])\n'
        keyword = 'User.objects.bulk_update(rows, fields=("account_status",))\n'

        assert _unmarked_writes(positional) == [(1, ["admin_confirmed"])]
        assert _unmarked_writes(keyword) == [(1, ["account_status"])]

    def test_a_dict_unpacked_into_update(self) -> None:
        source = 'rows.update(**{"account_status": "active"})\n'

        assert _unmarked_writes(source) == [(1, ["account_status"])]

    def test_the_marker_on_any_line_of_the_call(self) -> None:
        source = (
            "rows.update(\n"
            "    admin_confirmed=True,  # state-field-update-allowed: no side effects\n"
            ")\n"
        )

        assert _unmarked_writes(source) == []

    def test_reads_names_in_text_and_other_calls_do_not_count(self) -> None:
        source = (
            "rows.filter(admin_confirmed=False)\n"
            '"""rows.update(admin_confirmed=True)"""\n'
            '# rows.update(account_status="active")\n'
            'User.objects.update_or_create(account_status="active")\n'
            'rows.update(note="admin_confirmed")\n'
        )

        assert _unmarked_writes(source) == []
