"""Service layer for creating tenants together with their owner."""

from apps.accounts.services.employee_service import EmployeeService, EmployeeServiceError
from apps.accounts.services.membership_policy import MembershipPolicyError, assert_can_own_tenants
from django.db import transaction
from apps.tenants.models import SellerProfile, Tenant
from apps.tenants.receipt_settings import RECEIPT_SETTING_FIELDS
from django.contrib.auth import get_user_model
from django.conf import settings

User = get_user_model()


class TenantServiceError(Exception):
    """Base exception for TenantService failures."""

class TenantService:
    """Encapsulates the business rules for creating and managing tenants."""

    COPYABLE_SETTINGS = (
        "usd_rate", "auto_usd_rate", "daily_report_time", "daily_report_target", "shift_report_target",
        "telegram_group_id", "notify_web_reports", "notify_on_sale", "notify_on_debt",
        "low_stock_report_target", "low_stock_report_time", "low_stock_frequency",
        "low_stock_weekday", "low_stock_day_of_month", "notify_web_low_stock",
        "receipt_header", "receipt_footer", "receipt_phone",
    ) + RECEIPT_SETTING_FIELDS

    @staticmethod
    @transaction.atomic
    def bind_seller_profile(*, owner: User, tenant_id: int, seller_profile=None) -> Tenant:
        tenant = Tenant.objects.select_for_update().filter(pk=tenant_id, owner=owner).first()
        if tenant is None:
            raise TenantServiceError("Do‘kon topilmadi yoki sizga tegishli emas.")
        if seller_profile is not None and seller_profile.owner_id != owner.id:
            raise TenantServiceError("Faqat o‘zingizga tegishli sotuvchi profilini tanlang.")
        previous_id = tenant.seller_profile_id
        tenant.seller_profile = seller_profile
        tenant.save(update_fields=["seller_profile"])
        from apps.core.models import AuditAction
        from apps.core.services.audit_service import AuditService
        AuditService.log(
            action=AuditAction.SELLER_PROFILE_BINDING,
            actor=owner,
            tenant=tenant,
            target_model="Tenant",
            target_id=str(tenant.id),
            changes={"seller_profile_id": {"old": previous_id, "new": seller_profile.id if seller_profile else None}},
            description=f"Seller profile binding changed for tenant {tenant.id}",
        )
        return tenant

    @staticmethod
    @transaction.atomic
    def create_for_existing_owner(
        *, owner: User, name: str, description: str = "", address: str = "",
        copy_settings_from=None, seller_profile=None,
    ) -> Tenant:
        try:
            assert_can_own_tenants(owner)
        except MembershipPolicyError as exc:
            raise TenantServiceError(str(exc)) from exc

        has_active_shop = owner.employments.filter(
            is_owner=True, is_active=True, tenant__owner=owner, tenant__is_active=True
        ).exists()
        if not has_active_shop:
            raise TenantServiceError("Sizda faol do‘kon yo‘q.")

        maximum = getattr(settings, "MAX_TENANTS_PER_OWNER", 10)
        if Tenant.objects.filter(owner=owner).count() >= maximum:
            raise TenantServiceError("Do‘konlar soni chegarasiga yetdingiz.")
        name = name.strip()
        if Tenant.objects.filter(name__iexact=name).exists():
            raise TenantServiceError("Bunday nomli do‘kon allaqachon mavjud.")

        source = None
        if copy_settings_from is not None:
            source = Tenant.objects.filter(pk=copy_settings_from, owner=owner).first()
            if source is None:
                raise TenantServiceError("Sozlamalar faqat o‘zingizga tegishli do‘kondan nusxalanadi.")

        if seller_profile is not None:
            if not isinstance(seller_profile, SellerProfile) or seller_profile.owner_id != owner.id:
                raise TenantServiceError("Faqat o‘zingizga tegishli sotuvchi profilini tanlang.")
        elif source is not None and source.seller_profile:
            seller_profile = source.seller_profile
        else:
            approved_profiles = SellerProfile.objects.filter(owner=owner, status=SellerProfile.STATUS_APPROVED)
            if approved_profiles.count() == 1:
                seller_profile = approved_profiles.first()

        tenant = Tenant(
            name=name, owner=owner, description=description, address=address,
            seller_profile=seller_profile,
        )
        if source is not None:
            for field in TenantService.COPYABLE_SETTINGS:
                setattr(tenant, field, getattr(source, field))
        tenant.save()
        from apps.accounts.models import Employee
        Employee.objects.create(
            user=owner, tenant=tenant, is_owner=True, position="Owner", hired_by=owner
        )

        from apps.core.models import AuditAction
        from apps.core.services.audit_service import AuditService
        AuditService.log(
            action=AuditAction.TENANT_CREATE,
            actor=owner,
            tenant=tenant,
            target_model="Tenant",
            target_id=str(tenant.id),
            changes={"name": name, "seller_profile_id": seller_profile.id if seller_profile else None},
            description=f"Tenant {tenant.id} created by owner {owner.id}",
        )
        return tenant

    @staticmethod
    @transaction.atomic
    def create_with_owner(
            *,
            name: str,
            created_by: User,
            owner_phone_number: str = None,
            owner_email: str = None,
            owner_user: User = None,
            description: str = ""
    ) -> Tenant:
        """
        Create a new Tenant with an owner, and open the matching 'Owner'
        Employee record in one atomic operation.

        Only platform_admin may call this.
        Accepts `owner_phone_number` and optional `owner_email` (preferred:
        gets or creates the User record automatically) or `owner_user` (for backward
        compatibility with existing callers/tests).
        An owner may own multiple tenants; staff and platform admins are not
        converted to owners implicitly.
        """
        if created_by.role != "platform_admin":
            raise TenantServiceError("Only platform_admin may create tenants.")

        if owner_phone_number:
            owner_phone_number = User.objects.normalize_phone_number(owner_phone_number)
            defaults = {"role": "owner", "profile_completed": False}
            if owner_email:
                defaults["email"] = owner_email
            owner_user, created = User.objects.get_or_create(
                phone_number=owner_phone_number,
                defaults=defaults
            )
            if created:
                owner_user.set_unusable_password()
                owner_user.save(update_fields=["password"])
        elif owner_user is None:
            raise TenantServiceError("Either owner_phone_number or owner_user must be provided.")

        if owner_email and owner_user.email and owner_user.email.casefold() != owner_email.casefold():
            raise TenantServiceError("Bu telefon raqamiga boshqa email biriktirilgan. Mavjud egani tekshiring.")
        if owner_email and not owner_user.email:
            owner_user.email = owner_email
            owner_user.save(update_fields=["email"])

        if owner_user.role == "platform_admin":
            raise TenantServiceError("A platform_admin cannot be assigned as a tenant owner.")
        try:
            assert_can_own_tenants(owner_user)
        except MembershipPolicyError as exc:
            raise TenantServiceError(str(exc)) from exc

        if Tenant.objects.filter(name__iexact=name.strip()).exists():
            raise TenantServiceError(f"A tenant named '{name}' already exists.")

        tenant = Tenant.objects.create(
            name=name,
            owner=owner_user,
            description=description,
        )

        try:
            EmployeeService.hire(
                target_user=owner_user,
                tenant=tenant,
                hired_by=created_by,
                position="Owner",
                role="owner",
            )
        except EmployeeServiceError as exc:
            raise TenantServiceError(str(exc)) from exc

        return tenant

    @staticmethod
    @transaction.atomic
    def change_owner(
            *,
            tenant: Tenant,
            new_owner: User,
            changed_by: User,
    ) -> Tenant:
        """
        Replace a tenant's owner. Fires the current owner via the standard
        fire() flow -- their Employee record is deactivated and their
        password is set unusable, but User.role stays "owner" for audit
        purposes (Variant A). This is safe: PermissionService requires an
        ACTIVE Employee record for the owner role, so the former owner
        loses all permissions immediately despite the retained role label.
        Then hires the new owner.
        Only platform_admin may call this.
        :param tenant:
        :param new_owner:
        :param changed_by:
        :return Tenant:
        """
        if changed_by.role != "platform_admin":
            raise TenantServiceError("Only platform_admin may change tenant's owner.")
        if new_owner.role == "platform_admin":
            raise TenantServiceError("A platform_admin cannot be assigned as a tenant owner.")
        try:
            assert_can_own_tenants(new_owner)
        except MembershipPolicyError as exc:
            raise TenantServiceError(str(exc)) from exc
        old_owner = tenant.owner
        try:
            EmployeeService.fire(
                target_user=old_owner,
                fired_by=changed_by,
                tenant=tenant,
            )
        except EmployeeServiceError as exc:
            if "No active Employee record found" not in str(exc):
                raise TenantServiceError(str(exc)) from exc

        try:
            EmployeeService.hire(
                target_user=new_owner,
                tenant=tenant,
                hired_by=changed_by,
                position="Owner",
                role="owner",
            )
        except EmployeeServiceError as exc:
            raise TenantServiceError(str(exc)) from exc

        tenant.owner = new_owner
        tenant.save(update_fields=["owner"])

        from apps.core.models import AuditAction
        from apps.core.services.audit_service import AuditService
        AuditService.log(
            action=AuditAction.OWNER_TRANSFER,
            actor=changed_by,
            tenant=tenant,
            target_model="Tenant",
            target_id=str(tenant.id),
            changes={"owner_id": {"old": old_owner.id, "new": new_owner.id}},
            description=f"Tenant '{tenant.name}' owner changed from {old_owner.id} to {new_owner.id} by {changed_by.id}",
        )

        return tenant
