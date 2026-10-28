from django.db import transaction
from django.utils import timezone

from apps.core.models import AuditAction
from apps.core.services.audit_service import AuditService
from apps.tenants.models import SellerProfile


class SellerProfileServiceError(Exception):
    pass


class SellerProfileService:
    @staticmethod
    @transaction.atomic
    def submit(*, owner, values, profile=None):
        if profile is not None and profile.owner_id != owner.id:
            raise SellerProfileServiceError("Bu sotuvchi profiliga kirish huquqingiz yo‘q.")
        if profile is not None:
            changed = any(getattr(profile, key) != value for key, value in values.items())
            if changed:
                profile.reviewed_at = None
                profile.reviewed_by = None
                profile.expires_at = None
                profile.review_reason = ""
        if profile is None:
            profile = SellerProfile(owner=owner, **values)
        else:
            for key, value in values.items():
                setattr(profile, key, value)
        profile.status = SellerProfile.STATUS_PENDING
        profile.submitted_at = timezone.now()
        profile.save()
        AuditService.log(
            action=AuditAction.SELLER_PROFILE_SUBMIT,
            actor=owner,
            target_model="SellerProfile",
            target_id=str(profile.id),
            changes={"status": profile.status, "legal_form": profile.legal_form},
            description=f"Seller profile submitted: {profile.id}",
        )
        return profile

    @staticmethod
    @transaction.atomic
    def review(*, profile_id, reviewed_by, status, reason="", expires_at=None):
        if status not in {
            SellerProfile.STATUS_APPROVED,
            SellerProfile.STATUS_REJECTED,
            SellerProfile.STATUS_EXPIRED,
        }:
            raise SellerProfileServiceError("Tekshiruv holati noto‘g‘ri.")
        profile = SellerProfile.objects.select_for_update().get(pk=profile_id)
        if status == SellerProfile.STATUS_REJECTED and not reason.strip():
            raise SellerProfileServiceError("Rad etish sababi kiritilishi shart.")
        if status == SellerProfile.STATUS_APPROVED and expires_at is None:
            raise SellerProfileServiceError("Tasdiq amal qilish muddati bilan berilishi kerak.")
        if status == SellerProfile.STATUS_APPROVED and expires_at <= timezone.now():
            raise SellerProfileServiceError("Tasdiq muddati kelajakdagi vaqt bo‘lishi kerak.")
        profile.status = status
        profile.reviewed_by = reviewed_by
        profile.reviewed_at = timezone.now()
        profile.expires_at = expires_at
        profile.review_reason = reason.strip()
        profile.save(update_fields=[
            "status", "reviewed_by", "reviewed_at", "expires_at", "review_reason", "updated_at",
        ])
        AuditService.log(
            action=AuditAction.SELLER_PROFILE_REVIEW,
            actor=reviewed_by,
            target_model="SellerProfile",
            target_id=str(profile.id),
            changes={"status": status, "expires_at": expires_at.isoformat() if expires_at else None},
            description=f"Seller profile reviewed: {profile.id}",
        )
        return profile
