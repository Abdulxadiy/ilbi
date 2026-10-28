from apps.accounts.models import Employee


class MembershipPolicyError(Exception):
    """Raised when an account cannot be assigned another tenant role."""


def assert_can_be_hired_as_staff(user):
    if user.role == "owner":
        raise MembershipPolicyError("Do‘kon egasi boshqa do‘konga xodim bo‘la olmaydi.")
    if user.role == "platform_admin":
        raise MembershipPolicyError("Bu foydalanuvchini xodim qilib bo‘lmaydi.")
    if Employee.objects.filter(user=user, is_active=True).exists():
        raise MembershipPolicyError("Bu foydalanuvchi boshqa joyda faol ishlayapti.")


def assert_can_own_tenants(user):
    if user.role != "owner":
        raise MembershipPolicyError(
            "Faqat 'owner' rolidagi foydalanuvchi do‘kon egasi bo‘la oladi."
        )
