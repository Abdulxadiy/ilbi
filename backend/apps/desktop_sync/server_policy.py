"""The packaged app only sends cloud credentials to the official origin.

Keep OFFICIAL_SERVER aligned with desktop/ilbi/runtime.cjs. A domain migration
requires a reviewed application release, never a UI field or environment override.
"""

OFFICIAL_SERVER = "https://ilbi.uz"


def migrate_stored_server(value):
    """Translate the previous encrypted setting locally; never send requests there."""
    if value in ("https://new-dev.site", "https://new-dev.site/"):
        return OFFICIAL_SERVER
    return server_url(value)


def server_url(value):
    if value not in (OFFICIAL_SERVER, OFFICIAL_SERVER + "/"):
        raise ValueError(
            "Server manzili rasmiy ILBI manziliga mos emas. Ilovani rasmiy saytdan "
            "yangilang yoki yordam xizmatiga murojaat qiling. Ma’lumotlar papkasini o‘chirmang."
        )
    return OFFICIAL_SERVER
