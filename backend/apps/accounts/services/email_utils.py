"""
Utilities for masking and sanitizing email addresses for safe API exposure.
"""


def mask_email(email: str) -> str:
    """
    Mask an email address for safe display in API responses without leaking the full address.

    Examples:
    'john.doe@example.com' -> 'jo***oe@example.com'
    'alice@example.com' -> 'al***ce@example.com'
    'john@gmail.com' -> 'j*n@gmail.com'
    'me@domain.uz' -> 'm*@domain.uz'
    'a@domain.uz' -> '*@domain.uz'
    """
    if not email or "@" not in email:
        return "***"

    email_clean = email.strip()
    if "@" not in email_clean:
        return "***"

    local_part, domain = email_clean.split("@", 1)
    n = len(local_part)

    if n <= 1:
        masked_local = "*"
    elif n == 2:
        masked_local = f"{local_part[0]}*"
    elif n <= 4:
        masked_local = f"{local_part[0]}*{local_part[-1]}"
    else:
        masked_local = f"{local_part[:2]}***{local_part[-2:]}"

    return f"{masked_local}@{domain}"
