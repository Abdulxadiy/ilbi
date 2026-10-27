"""Keep credential material out of new audit records and historical API output.

Public artifact checksums, certificate fingerprints, financial IDs and operation
keys are not credentials and are deliberately left intact.
"""
import re
from collections.abc import Mapping

REDACTED = '[YASHIRILGAN]'
_SAFE_FLAGS = {'passwordset', 'passwordchanged', 'hasusablepassword', 'tokenversion', 'securityversion'}
_SECRET_KEYS = {
    'password', 'passwd', 'pwd', 'oldpassword', 'newpassword', 'passwordhash', 'passworddigest',
    'access', 'refresh', 'token', 'accesstoken', 'refreshtoken', 'resettoken', 'invitationtoken',
    'invitationkey', 'loginticket', 'credentialticket', 'actorticket', 'offlinegrant',
    'secret', 'clientsecret', 'apikey', 'privatekey', 'authorization', 'cookie', 'setcookie',
    'sessionid', 'sessionkey', 'csrftoken', 'otp', 'otpcode', 'recoverycode', 'guesthash',
    'revokesecret', 'revokesecretdigest', 'tokenciphertext', 'credentialdigest', 'publictoken',
    'bottoken', 'telegrambottoken', 'verificationcode', 'logincode', 'resetcode', 'mfacode',
    'totp', 'totpsecret', 'backupcodes', 'serviceaccount', 'credentials',
}
_HASH = re.compile(r'\b(?:pbkdf2_sha256|pbkdf2_sha1|argon2|scrypt|bcrypt_sha256|bcrypt|md5|sha1)\$[^\s"\'<>,;]+', re.IGNORECASE)
_BCRYPT = re.compile(r'\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}')
_JWT = re.compile(r'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b')
_PRIVATE_KEY = re.compile(r'-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----.*?-----END (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----', re.DOTALL)
_AUTH = re.compile(r'\bAuthorization\s*[:=]\s*(?:Bearer|Basic)\s+[^\s,;"\']+', re.IGNORECASE)
_INLINE = re.compile(r'''(\b(?:password|passwd|old_password|new_password|access_token|refresh_token|reset_token|token|client_secret|api_key|private_key)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;]+)''', re.IGNORECASE)


def _normalized_key(key):
    return re.sub(r'[^a-z0-9]', '', str(key).lower())


def _secret_key(key):
    value = _normalized_key(key)
    return value not in _SAFE_FLAGS and (value in _SECRET_KEYS or value.endswith(('password', 'passwordhash', 'passworddigest', 'privatekey', 'privkey', 'secret', 'token', 'credentialdigest')))


def safe_audit_text(value):
    if not isinstance(value, str):
        return value
    value = _PRIVATE_KEY.sub(REDACTED, value)
    value = _AUTH.sub('Authorization: ' + REDACTED, value)
    value = _HASH.sub(REDACTED, value)
    value = _BCRYPT.sub(REDACTED, value)
    value = _JWT.sub(REDACTED, value)
    return _INLINE.sub(lambda match: match.group(1) + REDACTED, value)


def safe_audit_data(value):
    if isinstance(value, Mapping):
        # Historical change rows also store a field name separately from its
        # payload: {'field': 'password', 'old': '...', 'new': '...'}. Keep the
        # harmless marker for audit context while hiding only its value cells.
        secret_row = any(
            _normalized_key(key) in {'key', 'field', 'label'}
            and isinstance(item, str) and _secret_key(item)
            for key, item in value.items()
        )
        value_keys = {'value', 'old', 'new', 'before', 'after', 'oldvalue', 'newvalue', 'previousvalue', 'currentvalue'}
        return {
            key: (None if item is None else REDACTED)
            if _secret_key(key) or secret_row and _normalized_key(key) in value_keys
            else safe_audit_data(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [safe_audit_data(item) for item in value]
    return safe_audit_text(value)
