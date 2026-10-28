from django.contrib.auth import get_user_model
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from apps.accounts.services.demo_access_service import DemoAccessService
from apps.accounts.token_validation import has_current_token_version


class RevocableTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        token = RefreshToken(attrs["refresh"])
        user = get_user_model().objects.filter(pk=token.get("user_id"), is_active=True).first()
        if user is None or DemoAccessService.is_blocked(user) or not has_current_token_version(token, user):
            raise InvalidToken("Sessiya bekor qilingan. Qaytadan kiring.")
        from apps.accounts.services.daily_mfa import verified_at

        verified_at(token)
        if token.get("desktop_cloud_device"):
            from apps.desktop_sync.device_credentials import trusted_device_valid

            if not trusted_device_valid(user, token["desktop_cloud_device"]):
                raise InvalidToken("Qurilma ruxsati bekor qilingan.")
        return super().validate(attrs)


class RevocableTokenRefreshView(TokenRefreshView):
    serializer_class = RevocableTokenRefreshSerializer
