from apps.core.media_urls import public_media_url
from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.accounts.models.employee_model import Employee
from apps.permissions.constants import OWNER_ONLY_PERMISSIONS
from apps.permissions.models import Permission

User = get_user_model()


class CompleteProfileSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    date_of_birth = serializers.DateField(required=False, allow_null=True)
    contact_phone = serializers.CharField(max_length=20, required=False, allow_blank=True, allow_null=True)


class UserProfileSerializer(serializers.ModelSerializer):
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    avatar_url = serializers.SerializerMethodField()
    tenants = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "phone_number",
            "contact_phone",
            "username",
            "email",
            "first_name",
            "last_name",
            "date_of_birth",
            "role",
            "role_display",
            "tenants",
            "permissions",
            "avatar",
            "avatar_url",
            "profile_completed",
            "terms_accepted",
            "terms_accepted_at",
            "terms_accepted_ip",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "phone_number",
            "role",
            "role_display",
            "terms_accepted",
            "terms_accepted_at",
            "terms_accepted_ip",
            "created_at",
        ]

    def get_avatar_url(self, obj) -> str | None:
        if obj.avatar and hasattr(obj.avatar, "url"):
            url = obj.avatar.url
            return public_media_url(url)
        return None

    def get_tenants(self, obj) -> list[dict]:
        return [
            {
                "id": membership.tenant_id,
                "name": membership.tenant.name,
                "is_owner": membership.is_owner,
                "permissions": ["*"] if membership.is_owner else sorted(f"{p.category}.{p.codename}" for p in membership.permissions.all()),
            }
            for membership in obj.employments.filter(
                is_active=True, tenant__is_active=True
            ).select_related("tenant").prefetch_related("permissions").order_by("tenant__name", "tenant_id")
        ]

    def get_permissions(self, obj) -> list[str]:
        if obj.role == "platform_admin":
            return ["*"]
        memberships = obj.employments.filter(is_active=True, tenant__is_active=True).prefetch_related("permissions")
        request = self.context.get("request")
        tenant_id = request.META.get("HTTP_X_TENANT_ID") if request else None
        if tenant_id:
            if not str(tenant_id).isdigit():
                return []
            employee = memberships.filter(tenant_id=tenant_id).first()
        else:
            employee = memberships.first() if memberships.count() == 1 else None
        if employee is None:
            return []
        return ["*"] if employee.is_owner else sorted(
            f"{permission.category}.{permission.codename}" for permission in employee.permissions.all()
        )


class UserProfileUpdateSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=50, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=50, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    date_of_birth = serializers.DateField(required=False, allow_null=True)
    contact_phone = serializers.CharField(max_length=20, required=False, allow_blank=True, allow_null=True)


class EmployeeHireSerializer(serializers.Serializer):
    """Validates input for hiring a new staff member."""

    phone_number = serializers.CharField(max_length=20, required=False)
    email = serializers.EmailField(required=False, allow_blank=True)
    first_name = serializers.CharField(max_length=50, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=50, required=False, allow_blank=True)
    target_user_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), source="target_user", required=False
    )
    position = serializers.CharField(required=False, allow_blank=True, default="")
    permission_ids = serializers.PrimaryKeyRelatedField(
        queryset=Permission.objects.all(), many=True, required=False, source="permissions"
    )
    role = serializers.CharField(read_only=True, default="staff")

    def validate_permission_ids(self, permissions):
        if any(permission.full_code in OWNER_ONLY_PERMISSIONS for permission in permissions):
            raise serializers.ValidationError("Faqat do‘kon egasiga tegishli ruxsatlarni xodimga berib bo‘lmaydi.")
        return permissions

    def validate(self, attrs):
        if not attrs.get("phone_number") and not attrs.get("target_user"):
            raise serializers.ValidationError(
                "Either phone_number or target_user_id must be provided."
            )
        return attrs


class EmployeeFireSerializer(serializers.Serializer):
    """Validates input for firing a staff member."""

    target_user_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), source="target_user"
    )


class EmployeeOutputSerializer(serializers.ModelSerializer):
    """Represents an Employee record in API response."""

    phone_number = serializers.CharField(source="user.phone_number", read_only=True)
    contact_phone = serializers.CharField(source="user.contact_phone", read_only=True, allow_null=True)

    class Meta:
        model = Employee
        fields = [
            "id",
            "user",
            "phone_number",
            "contact_phone",
            "tenant",
            "position",
            "is_active",
            "hired_at",
            "fired_at",
        ]
        read_only_fields = fields


class EmployeeListSerializer(EmployeeOutputSerializer):
    """Minimal account details needed to manage one tenant's team."""

    first_name = serializers.CharField(source="user.first_name", read_only=True)
    last_name = serializers.CharField(source="user.last_name", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True, allow_null=True)
    email = serializers.EmailField(source="user.email", read_only=True, allow_null=True)
    role = serializers.SerializerMethodField()
    account_active = serializers.BooleanField(source="user.is_active", read_only=True)
    password_set = serializers.SerializerMethodField()
    actions = serializers.SerializerMethodField()
    permission_ids = serializers.PrimaryKeyRelatedField(source='permissions', many=True, read_only=True)

    class Meta(EmployeeOutputSerializer.Meta):
        fields = EmployeeOutputSerializer.Meta.fields + [
            "first_name", "last_name", "username", "email", "role",
            "is_owner", "account_active", "password_set",
            "archived_at", "actions", "permission_ids",
        ]
        read_only_fields = fields

    def get_role(self, obj) -> str:
        return "owner" if obj.is_owner else "staff"

    def get_password_set(self, obj) -> bool:
        return obj.user.has_usable_password()

    def get_actions(self, obj) -> dict[str, bool]:
        from apps.accounts.services.employee_management_service import EmployeeManagementService

        request = self.context.get("request")
        if request is None:
            return {}
        return EmployeeManagementService.allowed_actions(request.user, obj)


class EmployeeEditSerializer(serializers.Serializer):
    """Editable directory fields; authentication identity and roles stay protected."""

    first_name = serializers.CharField(max_length=50, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=50, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    contact_phone = serializers.RegexField(
        r"^\+?[0-9][0-9\s()-]{5,19}$", max_length=20, required=False, allow_blank=True,
    )
    position = serializers.CharField(max_length=100, required=False, allow_blank=True)
    permission_ids = serializers.PrimaryKeyRelatedField(queryset=Permission.objects.all(), many=True, source='permissions', required=False)

    def to_internal_value(self, data):
        if isinstance(data, dict) and set(data) - set(self.fields):
            raise serializers.ValidationError({"non_field_errors": [
                "Faqat ism, familiya, email, aloqa raqami va lavozimni tahrirlash mumkin."
            ]})
        return super().to_internal_value(data)

    def validate_email(self, value):
        employee = self.context["employee"]
        if value and value.casefold() != (employee.user.email or "").casefold() and User.objects.filter(
            email__iexact=value,
        ).exclude(pk=employee.user_id).exists():
            raise serializers.ValidationError("Bu email boshqa hisobga biriktirilgan.")
        return value

    def validate_permission_ids(self, permissions):
        if any(permission.full_code in OWNER_ONLY_PERMISSIONS for permission in permissions):
            raise serializers.ValidationError("Faqat do‘kon egasiga tegishli ruxsatlarni xodimga berib bo‘lmaydi.")
        return permissions


class EmployeeActionReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500)


class EmployeeBlockSerializer(EmployeeActionReasonSerializer):
    blocked = serializers.BooleanField()


class AdminLoginSerializer(serializers.Serializer):
    """Step 1 of admin-login: username + password."""
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)


class AdminLoginVerifyOTPSerializer(serializers.Serializer):
    """Final login step: the verified login ticket and Telegram OTP."""
    login_ticket = serializers.CharField(max_length=128)
    verification_code = serializers.CharField(max_length=6, min_length=6)


class AdminLoginTicketSerializer(serializers.Serializer):
    """The proof returned after a valid password or account setup link."""
    login_ticket = serializers.CharField(max_length=128)


class UnbanSerializer(serializers.Serializer):
    """Validates input for restoring a permanently-banned user's access.
        Uses target_user_id (not username) so this also works for customers,
        who never have a username -- see UnbanView."""
    target_user_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        source="target_user"
    )


class PasswordResetRequestSerializer(serializers.Serializer):
    """Step 1 of the magic-link password flow: supply the login identifier (or e-mail address).

    The response is always HTTP 200 to prevent user enumeration — the caller
    can never tell whether the address exists in the system.
    """

    email = serializers.EmailField(required=False, allow_null=True)
    login = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        email = (attrs.get("email") or "").strip()
        login = (attrs.get("login") or "").strip()
        if not email and not login:
            raise serializers.ValidationError("Foydalanuvchi nomi, telefon raqam yoki email kiritilishi shart.")
        attrs["identifier"] = login or email
        return attrs


class ChangePasswordWithOldSerializer(serializers.Serializer):
    """Change password using old password verification when email is not available."""

    login = serializers.CharField()
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)


class PasswordResetConfirmSerializer(serializers.Serializer):
    """Step 2 of the magic-link password flow: consume the token and set a password.

    Fields
    ------
    token       -- The opaque one-time token from the magic link URL.
    new_password -- The password the user wants to set.
    username    -- Optional.  Only required when this is the *first* login and
                   the user has not chosen a username yet (i.e. the User record
                   has no username).  Ignored when a username is already set.
    """

    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, min_length=8)
    username = serializers.CharField(required=False, allow_blank=True, default="")


class InvitationResumeSerializer(serializers.Serializer):
    """A pending invitation link can resume Telegram verification only."""

    token = serializers.CharField(max_length=128)
