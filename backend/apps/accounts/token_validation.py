"""Shared token-version policy for access authentication and refresh."""


def has_current_token_version(token, user):
    # JSON booleans and floats can compare equal to Python integers.
    # Require an actual JSON integer before comparing the account version.
    version = token.get("token_version")
    return type(version) is int and version == user.token_version
