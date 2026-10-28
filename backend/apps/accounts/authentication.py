from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed

from .services.demo_access_service import DemoAccessService
from .token_validation import has_current_token_version


class CustomJWTAuthentication(JWTAuthentication):
    """
    Extends SimpleJWT's JWTAuthentication to enforce immediate token invalidation:
    When user.token_version is incremented (e.g. employee fired, password reset,
    admin ban/unban), any active JWT token with an older token_version is immediately
    rejected with 401 Unauthorized. Missing or malformed versions are also rejected.
    """

    def get_user(self, validated_token):
        user = super().get_user(validated_token)

        if DemoAccessService.is_blocked(user) or not has_current_token_version(validated_token, user):
            raise AuthenticationFailed(
                "Token has been revoked or expired.",
                code="token_revoked",
            )

        from .services.daily_mfa import verified_at

        verified_at(validated_token)

        if validated_token.get("desktop_cloud_device"):
            from apps.desktop_sync.device_credentials import trusted_device_valid

            if not trusted_device_valid(user, validated_token["desktop_cloud_device"]):
                raise AuthenticationFailed("Qurilma ruxsati bekor qilingan.", code="device_revoked")

        return user
