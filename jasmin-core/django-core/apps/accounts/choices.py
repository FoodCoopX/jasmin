from django.db import models


class ThemeChoices(models.TextChoices):
    # Follow the device's light or dark setting — the default, until the user
    # picks one of the other two.
    SYSTEM = "system", "System"
    LIGHT = "light", "Light"
    DARK = "dark", "Dark"