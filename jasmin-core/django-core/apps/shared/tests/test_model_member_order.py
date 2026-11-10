"""Guard: every model class keeps Django's member order.

Django's coding style orders a model's body as: database fields, custom
managers, ``class Meta``, ``__str__()`` and the other magic methods, ``save()``,
``get_absolute_url()``, then every other method. Class constants, choices
classes and other class attributes come before the fields, as in Django's own
choices example. ``clean()`` and ``delete()`` are not on Django's list, so they
count as custom methods and follow ``save()``.

The check reads every model module's source and asks the model class itself
which names are fields (``_meta``) and which are managers, so a field built by a
helper such as ``week_field()`` counts as a field. Abstract models are checked
too; plain mixins that aren't models are not.

If this test fails: move the listed members into that order, and keep each
group's own order — the fields' order is ``_meta.fields`` (and with it every
``fields = "__all__"`` serializer and the schema), and the first manager
declared is the default one.
"""

import ast
import pathlib
from importlib import import_module

from django.db import models

_APPS_DIR = pathlib.Path(__file__).resolve().parents[2]
_PROJECT_ROOT = _APPS_DIR.parent

CLASS_ATTRIBUTE = "class attribute"
FIELD = "field"
MANAGER = "manager"
META = "class Meta"
MAGIC_METHOD = "magic method"
SAVE = "save()"
GET_ABSOLUTE_URL = "get_absolute_url()"
CUSTOM_METHOD = "custom method"

ORDER = [
    CLASS_ATTRIBUTE,
    FIELD,
    MANAGER,
    META,
    MAGIC_METHOD,
    SAVE,
    GET_ABSOLUTE_URL,
    CUSTOM_METHOD,
]
RANK = {kind: rank for rank, kind in enumerate(ORDER)}


def model_modules() -> list[pathlib.Path]:
    """Every ``models.py`` and ``models/*.py`` outside tests and migrations."""
    paths = set(_APPS_DIR.rglob("models.py")) | set(_APPS_DIR.rglob("models/*.py"))
    return sorted(
        path
        for path in paths
        if not {"migrations", "tests", "__pycache__"}
        & set(path.relative_to(_APPS_DIR).parts)
    )


def _assigned_names(statement: ast.Assign | ast.AnnAssign) -> list[str]:
    targets = (
        statement.targets if isinstance(statement, ast.Assign) else [statement.target]
    )
    return [target.id for target in targets if isinstance(target, ast.Name)]


def _method_kind(name: str) -> str:
    if name.startswith("__") and name.endswith("__"):
        return MAGIC_METHOD
    if name == "save":
        return SAVE
    if name == "get_absolute_url":
        return GET_ABSOLUTE_URL
    return CUSTOM_METHOD


def _assignment_kind(
    statement: ast.Assign | ast.AnnAssign, model: type[models.Model]
) -> str:
    options = model._meta
    fields = {
        field.name
        for field in [
            *options.local_fields,
            *options.local_many_to_many,
            *options.private_fields,
        ]
    }
    managers = {manager.name for manager in options.local_managers}
    names = set(_assigned_names(statement))
    if names & fields:
        return FIELD
    if names & managers:
        return MANAGER
    if any(name.startswith("__") and name.endswith("__") for name in names):
        return MAGIC_METHOD
    value = statement.value
    if isinstance(value, ast.Call) and ast.unparse(value.func).split(".")[-1] in (
        "property",
        "cached_property",
        "staticmethod",
        "classmethod",
    ):
        return CUSTOM_METHOD
    return CLASS_ATTRIBUTE


def member_kind(statement: ast.stmt, model: type[models.Model]) -> str | None:
    """The kind of one class-body statement; None for what has no place."""
    if isinstance(statement, ast.ClassDef):
        return META if statement.name == "Meta" else CLASS_ATTRIBUTE
    if isinstance(statement, ast.FunctionDef | ast.AsyncFunctionDef):
        return _method_kind(statement.name)
    if isinstance(statement, ast.AnnAssign) and statement.value is None:
        return None
    if isinstance(statement, ast.Assign | ast.AnnAssign):
        # ``save.alters_data = True`` and the like belong to the member above.
        if not _assigned_names(statement):
            return None
        return _assignment_kind(statement, model)
    if isinstance(statement, ast.Import | ast.ImportFrom):
        return CLASS_ATTRIBUTE
    return None


def member_name(statement: ast.stmt) -> str:
    if isinstance(statement, ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
        return statement.name
    if isinstance(statement, ast.Assign | ast.AnnAssign):
        return ", ".join(_assigned_names(statement)) or ast.unparse(statement)[:40]
    return ast.unparse(statement)[:40]


def model_classes():
    """Yield ``(path, class node, model class)`` for every model in the scan."""
    for path in model_modules():
        dotted = ".".join(path.relative_to(_PROJECT_ROOT).with_suffix("").parts)
        module = import_module(dotted.removesuffix(".__init__"))
        for node in ast.parse(path.read_text()).body:
            if not isinstance(node, ast.ClassDef):
                continue
            model = getattr(module, node.name, None)
            if isinstance(model, type) and issubclass(model, models.Model):
                yield path, node, model


def order_violations(node: ast.ClassDef, model: type[models.Model]) -> list[str]:
    violations = []
    highest = None
    for statement in node.body:
        kind = member_kind(statement, model)
        if kind is None:
            continue
        if highest is not None and RANK[kind] < RANK[highest[0]]:
            violations.append(
                f"{node.name}.{member_name(statement)} ({kind}, line "
                f"{statement.lineno}) comes after {highest[0]} "
                f"{highest[1]} (line {highest[2]})"
            )
        elif highest is None or RANK[kind] > RANK[highest[0]]:
            highest = (kind, member_name(statement), statement.lineno)
    return violations


def test_the_scan_reaches_the_models():
    checked = {node.name for _path, node, _model in model_classes()}
    assert {
        "Member",
        "Share",
        "Tenant",
        "Employee",
        "Plot",
        "TimeBoundMixin",
    } <= checked


def test_models_keep_djangos_member_order():
    failures = []
    for path, node, model in model_classes():
        rel = path.relative_to(_PROJECT_ROOT)
        failures += [f"{rel}: {v}" for v in order_violations(node, model)]
    assert not failures, (
        "Model members out of Django's order ("
        + " → ".join(ORDER)
        + "):\n  "
        + "\n  ".join(failures)
    )
