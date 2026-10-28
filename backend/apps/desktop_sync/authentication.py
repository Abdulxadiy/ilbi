from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import AuthenticationFailed

from apps.accounts.authentication import CustomJWTAuthentication

from .local import get_state


class DesktopJWTAuthentication(CustomJWTAuthentication):
    check_lock = True

    def authenticate(self, request):
        from .security import register_id

        self.register = register_id(request)
        return super().authenticate(request)

    def get_user(self, validated_token):
        device = get_state("device")
        if not device or validated_token.get("desktop_device") != device["device_id"]:
            raise AuthenticationFailed("Offline qurilma sessiyasi tasdiqlanmadi.")
        if timezone.now() >= parse_datetime(device["lease_until"]):
            raise AuthenticationFailed("Offline ruxsat muddati tugadi. Internetga ulanib qayta tasdiqlang.")
        user = super().get_user(validated_token)
        actors = get_state("actors", {})
        if str(user.pk) not in actors:
            raise AuthenticationFailed("Bu hisob qurilmaga ulanmagan.")
        from .security import DesktopLocked, assert_mfa, assert_session, verified_actor, verify_session
        from .transport import Vault

        if get_state("security_denied", False) or Vault().read().get("security_denied", False):
            raise DesktopLocked("Server hisob yoki qurilma ruxsatini bekor qilgan. Internet orqali qayta tasdiqlang.")
        if user.is_superuser or user.is_staff:
            raise DesktopLocked("Mahalliy xodim ruxsati noto‘g‘ri. Internet orqali qayta tasdiqlang.")
        actor = actors[str(user.pk)]
        verified_actor(user, device, actor)
        register = getattr(self, "register", "primary")
        if validated_token.get("desktop_register") != register:
            raise DesktopLocked("Sessiya boshqa kassaga tegishli.")
        assert_mfa(user, device, actor, register)
        verify_session(user.pk, register, actor.get("sessions", {}).get(register, {}))
        if validated_token.get("desktop_session") != actor.get("sessions", {}).get(register, {}).get("id"):
            raise DesktopLocked("Eski sessiya tugagan. Hisobingizga qayta kiring.")
        if self.check_lock:
            assert_session(user, actor, register, validated_token)
        return user
