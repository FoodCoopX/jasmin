"""Guard: rules from Django's coding style and time-zone API that no linter
checks.

- **No settings read at import time.** A module-level or class-level read of
  ``settings.X`` (a default argument and a decorator count too) is evaluated
  once, when the module is imported, so a later ``override_settings`` never
  reaches it. ``settings.AUTH_USER_MODEL`` is exempt — Django's own pattern for
  pointing at the user model. ``config/`` holds the settings and the URL confs,
  which read ``DEBUG`` by design, and is not scanned.
- **Model choices are named.** A model field's ``choices`` is a
  ``TextChoices`` / ``IntegerChoices`` class or an upper-case class constant,
  never a literal list written into the field.
- **Test docstrings state the behaviour.** No "Tests that …" / "Ensures that …"
  / "Verify …" preamble on a test or a test class; the docstring says what
  holds.
- **Today is the local date.** ``timezone.now()`` is the UTC instant, so its
  ``.date()`` / ``.year`` / ``.isocalendar()`` is still yesterday between
  midnight and 01:00 (02:00 in summer) in ``TIME_ZONE``. ``timezone.localdate()``
  is today there. Migrations are not scanned: a shipped one stays as it ran.

Each rule has a detector over source text, pinned by its own cases below the
scans, so a detector that stops seeing something fails here rather than letting
every scan pass.
"""

import ast
import pathlib
import re
from collections.abc import Iterator

import pytest

from apps.shared.tests.test_model_member_order import model_modules

_APPS_DIR = pathlib.Path(__file__).resolve().parents[2]
_PROJECT_ROOT = _APPS_DIR.parent

IMPORT_TIME_SETTINGS_EXEMPT = {"AUTH_USER_MODEL"}
TEST_DOCSTRING_PREAMBLE = re.compile(
    r"(tests?|ensures?|checks?|asserts?|makes? sure)\s+(that|whether|if)\b"
    r"|verif(y|ies)\b",
    re.IGNORECASE,
)
_DATE_PARTS = {"date", "year", "month", "day", "isocalendar", "weekday", "isoweekday"}
_LITERAL_COLLECTIONS = (
    ast.List,
    ast.Tuple,
    ast.Dict,
    ast.Set,
    ast.ListComp,
    ast.SetComp,
    ast.DictComp,
    ast.GeneratorExp,
)


def _python_files(*directories: str) -> list[pathlib.Path]:
    return sorted(
        path
        for directory in directories
        for path in (_PROJECT_ROOT / directory).rglob("*.py")
        if not {"migrations", "__pycache__"}
        & set(path.relative_to(_PROJECT_ROOT).parts)
    )


def _import_time_nodes(tree: ast.Module) -> Iterator[ast.AST]:
    """Every node evaluated when the module is imported.

    A function body runs later, but its decorators and default values run at
    definition; a class body runs at import.
    """
    pending: list[ast.AST] = list(tree.body)
    while pending:
        node = pending.pop()
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda):
            if not isinstance(node, ast.Lambda):
                pending.extend(node.decorator_list)
            pending.extend(node.args.defaults)
            pending.extend(d for d in node.args.kw_defaults if d is not None)
            continue
        yield node
        pending.extend(ast.iter_child_nodes(node))


def _settings_names(tree: ast.Module) -> set[str]:
    """The names the module binds to ``django.conf.settings``."""
    return {
        alias.asname or alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module == "django.conf"
        for alias in node.names
        if alias.name == "settings"
    }


def _is_settings(node: ast.AST, names: set[str]) -> bool:
    if isinstance(node, ast.Name):
        return node.id in names
    return ast.unparse(node) == "django.conf.settings"


def _settings_read(node: ast.AST, names: set[str]) -> str | None:
    """The setting a node reads from ``django.conf.settings``, if it reads one."""
    if (
        isinstance(node, ast.Attribute)
        and node.attr.isupper()
        and _is_settings(node.value, names)
    ):
        return node.attr
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in ("getattr", "hasattr")
        and node.args
        and _is_settings(node.args[0], names)
    ):
        name = node.args[1] if len(node.args) > 1 else None
        return name.value if isinstance(name, ast.Constant) else "<dynamic>"
    return None


def import_time_settings_reads(source: str) -> list[tuple[int, str]]:
    """``(line, setting)`` for every setting read when the module is imported."""
    tree = ast.parse(source)
    names = _settings_names(tree)
    reads = []
    for node in _import_time_nodes(tree):
        setting = _settings_read(node, names)
        if setting and setting not in IMPORT_TIME_SETTINGS_EXEMPT:
            reads.append((getattr(node, "lineno", 0), setting))
    return sorted(reads)


def _timezone_now_names(tree: ast.Module) -> set[str]:
    """How the module can spell ``django.utils.timezone.now``."""
    names = {"django.utils.timezone.now"}
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom):
            continue
        for alias in node.names:
            if node.module == "django.utils" and alias.name == "timezone":
                names.add(f"{alias.asname or alias.name}.now")
            elif node.module == "django.utils.timezone" and alias.name == "now":
                names.add(alias.asname or alias.name)
    return names


def utc_today_reads(source: str) -> list[int]:
    """Lines that take a date part of ``timezone.now()``, the UTC instant."""
    tree = ast.parse(source)
    names = _timezone_now_names(tree)
    return sorted(
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Attribute)
        and node.attr in _DATE_PARTS
        and isinstance(node.value, ast.Call)
        and ast.unparse(node.value.func) in names
    )


def literal_choices(source: str) -> list[int]:
    """Lines where a ``choices=`` argument is a literal collection."""
    return sorted(
        node.value.lineno
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.keyword)
        and node.arg == "choices"
        and isinstance(node.value, _LITERAL_COLLECTIONS)
    )


def preamble_docstrings(source: str) -> list[tuple[int, str]]:
    """``(line, name)`` for every test or test class whose docstring opens with
    a preamble."""
    preambles = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            is_test = node.name.startswith("test")
        elif isinstance(node, ast.ClassDef):
            is_test = node.name.startswith("Test")
        else:
            continue
        docstring = ast.get_docstring(node)
        if is_test and docstring and TEST_DOCSTRING_PREAMBLE.match(docstring.strip()):
            preambles.append((node.lineno, node.name))
    return sorted(preambles)


def test_settings_are_not_read_at_import_time():
    failures = [
        f"{path.relative_to(_PROJECT_ROOT)}:{line} settings.{setting}"
        for path in _python_files("apps", "core")
        for line, setting in import_time_settings_reads(path.read_text())
    ]
    assert not failures, (
        "Settings read at import time — read them where they are used:\n  "
        + "\n  ".join(failures)
    )


def test_today_is_the_local_date():
    failures = [
        f"{path.relative_to(_PROJECT_ROOT)}:{line}"
        for path in _python_files("apps", "core")
        for line in utc_today_reads(path.read_text())
    ]
    assert not failures, (
        "A date taken from timezone.now(), which is UTC — use "
        "timezone.localdate():\n  " + "\n  ".join(failures)
    )


def test_model_field_choices_are_named():
    failures = [
        f"{path.relative_to(_PROJECT_ROOT)}:{line}"
        for path in model_modules()
        for line in literal_choices(path.read_text())
    ]
    assert not failures, (
        "Literal choices on a model field — use a TextChoices class or an "
        "upper-case class constant:\n  " + "\n  ".join(failures)
    )


def test_test_docstrings_state_the_behaviour():
    failures = []
    for path in _python_files("apps"):
        rel = path.relative_to(_PROJECT_ROOT)
        if "tests" not in rel.parts and not path.name.startswith("test_"):
            continue
        failures += [
            f"{rel}:{line} {name}"
            for line, name in preamble_docstrings(path.read_text())
        ]
    assert not failures, (
        'Test docstrings with a "Tests that …" preamble — state the behaviour '
        "instead:\n  " + "\n  ".join(failures)
    )


IMPORT = "from django.conf import settings\n"


@pytest.mark.parametrize(
    "source",
    [
        IMPORT + "LIMIT = settings.LIMIT\n",
        IMPORT + "class Token:\n    lifetime = settings.LIMIT\n",
        IMPORT + "@cache(timeout=settings.LIMIT)\ndef f():\n    pass\n",
        IMPORT + "def f(limit=settings.LIMIT):\n    pass\n",
        IMPORT + "def f(*, limit=settings.LIMIT):\n    pass\n",
        IMPORT + "LIMIT = getattr(settings, 'LIMIT', 1)\n",
        IMPORT + "HAS_LIMIT = hasattr(settings, 'LIMIT')\n",
        "from django.conf import settings as conf\nLIMIT = conf.LIMIT\n",
        "from django.conf import global_settings, settings\nLIMIT = settings.LIMIT\n",
        "import django.conf\nLIMIT = django.conf.settings.LIMIT\n",
        IMPORT + "LIMITS = [settings.LIMIT for _ in range(2)]\n",
    ],
)
def test_an_import_time_read_is_caught(source):
    assert [setting for _line, setting in import_time_settings_reads(source)] == [
        "LIMIT"
    ]


@pytest.mark.parametrize(
    "source",
    [
        IMPORT + "def f():\n    return settings.LIMIT\n",
        IMPORT + "def f(limit=None):\n    return limit or settings.LIMIT\n",
        IMPORT + "LIMIT = lambda: settings.LIMIT\n",
        IMPORT
        + "class Token:\n    def lifetime(self):\n        return settings.LIMIT\n",
        IMPORT + "user = ForeignKey(settings.AUTH_USER_MODEL, on_delete=CASCADE)\n",
        "settings = {'LIMIT': 1}\nLIMIT = settings['LIMIT']\n",
    ],
)
def test_a_read_at_use_time_passes(source):
    assert import_time_settings_reads(source) == []


@pytest.mark.parametrize(
    ("source", "caught"),
    [
        ("from django.utils import timezone\ntoday = timezone.now().date()", True),
        ("from django.utils import timezone\nyear = timezone.now().year", True),
        (
            "from django.utils import timezone as tz\nweek = tz.now().isocalendar()",
            True,
        ),
        ("from django.utils.timezone import now\ntoday = now().date()", True),
        ("import django.utils.timezone\nday = django.utils.timezone.now().day", True),
        ("from django.utils import timezone\ntoday = timezone.localdate()", False),
        ("from django.utils import timezone\nstamp = timezone.now()", False),
        ("from django.utils import timezone\nday = timezone.localtime().date()", False),
        ("today = self.now().date()", False),
    ],
)
def test_a_utc_today_is_caught(source, caught):
    assert bool(utc_today_reads(source)) is caught


@pytest.mark.parametrize(
    ("source", "caught"),
    [
        ("kind = CharField(choices=[('a', 'A')])", True),
        ("kind = CharField(choices=(('a', 'A'),))", True),
        ("kind = CharField(choices={'a': 'A'})", True),
        ("kind = CharField(choices=[(k, k) for k in KINDS])", True),
        ("kind = CharField(choices=Kind.choices)", False),
        ("kind = CharField(choices=KIND_CHOICES)", False),
    ],
)
def test_literal_choices_are_caught(source, caught):
    assert bool(literal_choices(source)) is caught


@pytest.mark.parametrize(
    ("docstring", "caught"),
    [
        ("Tests that a member can cancel.", True),
        ("Ensures that the total is rounded.", True),
        ("Check whether the week is past.", True),
        ("Verify the exemption on the guard.", True),
        ("Verifies that tax is grouped per rate.", True),
        ("A member can cancel before the deadline.", False),
        ("Tests for the offer service.", False),
        ("The checker accepts an empty list.", False),
    ],
)
def test_a_docstring_preamble_is_caught(docstring, caught):
    for source in (
        f'def test_x():\n    """{docstring}"""\n',
        f'class TestX:\n    """{docstring}"""\n',
    ):
        assert bool(preamble_docstrings(source)) is caught
