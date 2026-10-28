"""Password-only access for explicitly tagged, synthetic local demo accounts."""

from django.conf import settings

from apps.accounts.models import Employee


class DemoAccessService:
    GROUP_NAME = "ilbi_local_demo"
    LEGACY_GROUP_NAME = "inventra_local_demo"
    PHONE_PREFIX = "+99800"

    @classmethod
    def is_blocked(cls, user):
        """Synthetic accounts are usable only while local demo mode is enabled.

        The persistent group marker survives username/phone edits and protects
        tokens issued before demo mode was disabled, including legacy accounts.
        """
        if settings.DEBUG and settings.LOCAL_DEMO_LOGIN_ENABLED:
            return False
        return user.groups.filter(name__in=(cls.GROUP_NAME, cls.LEGACY_GROUP_NAME)).exists()

    @classmethod
    def enabled_for(cls, user):
        return bool(
            settings.DEBUG
            and settings.LOCAL_DEMO_LOGIN_ENABLED
            and (user.username or "").startswith("demo_")
            and user.phone_number.startswith(cls.PHONE_PREFIX)
            and user.groups.filter(name__in=(cls.GROUP_NAME, cls.LEGACY_GROUP_NAME)).exists()
        )

    @staticmethod
    def has_active_access(user):
        if user.role == "platform_admin":
            return True
        memberships = Employee.objects.filter(user=user, is_active=True, tenant__is_active=True)
        if user.role == "owner":
            return memberships.filter(is_owner=True, tenant__owner=user).exists()
        return user.role == "staff" and memberships.filter(is_owner=False).exists()
