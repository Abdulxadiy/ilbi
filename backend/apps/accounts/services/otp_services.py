import secrets

import redis
from django.conf import settings

redis_client = (
    redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    if getattr(settings, "REDIS_URL", None)
    else None
)

OTP_TTL_SECONDS = 180  # The code is valid for only 3 minutes
MAX_ATTEMPTS = 5       # Number of incorrect attempts
COOLDOWN_SECONDS = 60  # Waiting time to request an OTP again to a number

# A single Redis operation prevents concurrent requests from accepting the same OTP.
_VERIFY_CODE_SCRIPT = """
local attempts = redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[2])
if attempts > tonumber(ARGV[3]) then
    return 2
end
local stored = redis.call('GET', KEYS[1])
if not stored then
    return 1
end
if stored ~= ARGV[1] then
    if attempts >= tonumber(ARGV[3]) then
        return 2
    end
    return 3
end
redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
return 0
"""


def _otp_key(phone_number: str) -> str:
    return f"otp:{phone_number}"

def _attempts_key(phone_number: str) -> str:
    return f"otp_attempts:{phone_number}"

def _cooldown_key(phone_number: str) -> str:
    return f"cooldown:{phone_number}"

def generate_code() -> str:
    return ''.join(
        secrets.choice('0123456789')
        for _ in range(6)
    )

def is_in_cooldown(phone_number: str) -> bool:
    if not redis_client:
        return False
    return redis_client.exists(_cooldown_key(phone_number)) == 1

def get_cooldown_remaining(phone_number: str) -> int:
    """Returns the remaining seconds in cooldown, or 0 if not in cooldown."""
    if not redis_client:
        return 0
    ttl = redis_client.ttl(_cooldown_key(phone_number))
    return max(ttl, 0) if ttl and ttl > 0 else 0

def store_code(phone_number: str, code: str) -> None:
    if not redis_client:
        return
    redis_client.set(_otp_key(phone_number), code, ex=OTP_TTL_SECONDS)
    redis_client.set(_cooldown_key(phone_number), '1', ex=COOLDOWN_SECONDS)
    redis_client.delete(_attempts_key(phone_number))

def discard_code(phone_number: str) -> None:
    """
    If sanding to Telegram fails we cancel the saved code and cooldown,
    otherwise the user will wait for a code that he never sent.
    """
    if not redis_client:
        return
    redis_client.delete(_otp_key(phone_number))
    redis_client.delete(_cooldown_key(phone_number))
    redis_client.delete(_attempts_key(phone_number))

def verify_code(phone_number: str, code: str) -> tuple[bool, str]:
    """
    Returns (is_valid, error_reason)
    Error reason: 'expired' | 'too_many_attempts' | 'invalid_code' | ''
    """
    if not redis_client:
        return False, 'Expired'
    result = redis_client.eval(
        _VERIFY_CODE_SCRIPT,
        3,
        _otp_key(phone_number),
        _attempts_key(phone_number),
        _cooldown_key(phone_number),
        code,
        OTP_TTL_SECONDS,
        MAX_ATTEMPTS,
    )

    if result == 2:
        return False, 'Too many attempts'
    if result == 1:
        return False, 'Expired'
    if result == 3:
        return False, 'Invalid code'
    return True, ''
