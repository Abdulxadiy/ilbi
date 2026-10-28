from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from apps.accounts.services.permission_service import PermissionService
from apps.catalog.models import Category, Product, ProductVariant
from apps.catalog.models.import_model import CatalogImportJob
from apps.catalog.services import CategoryService, ProductService
from apps.core.spreadsheets import read_import_file
from apps.inventory.services import StockService
from apps.tenants.models import Tenant

HEADERS = {
    "mahsulot": "name",
    "kategoriya": "category",
    "variant": "variant_name",
    "birlik": "unit",
    "shtrix_kod": "barcode",
    "hamkor_narxi": "price_partner",
    "minimal_narx": "price_min",
    "sotuv_narxi": "price_recommended",
    "valyuta": "currency",
    "miqdor": "quantity",
    "tannarx": "cost_price",
    "partiya": "batch_code",
    "yaroqlilik_sanasi": "expires_on",
}
TEMPLATE_HEADERS = list(HEADERS)


class ImportRowSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    category = serializers.CharField(max_length=150)
    variant_name = serializers.CharField(max_length=150, default="Standart")
    unit = serializers.ChoiceField(choices=ProductVariant.UNIT_CHOICES, default="dona")
    barcode = serializers.CharField(max_length=64, allow_blank=True, default="")
    price_partner = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, default=0)
    price_min = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, default=0)
    price_recommended = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    currency = serializers.ChoiceField(choices=["UZS", "USD"], default="UZS")
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=0, default=0)
    cost_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, default=0)
    batch_code = serializers.CharField(max_length=80, allow_blank=True, default="")
    expires_on = serializers.DateField(required=False, allow_null=True)


class CatalogImportService:
    @staticmethod
    def check_rows(rows, tenant, user):
        checked = []
        seen_identity, seen_barcodes, seen_products = set(), set(), set()
        allowed = {
            code: PermissionService.has_permission(user, code, tenant=tenant)
            for code in ("catalog.add_category", "catalog.change_product", "inventory.add_stock_intake")
        }
        categories = list(Category.objects.filter(tenant=tenant))
        products = list(Product.objects.filter(tenant=tenant).prefetch_related("variants"))
        barcodes = set(
            ProductVariant.objects.filter(tenant=tenant)
            .exclude(barcode__isnull=True)
            .exclude(barcode="")
            .values_list("barcode", flat=True)
        )
        for row in rows:
            serializer = ImportRowSerializer(data=row["data"])
            errors = {}
            if not serializer.is_valid():
                errors = {field: " ".join(map(str, messages)) for field, messages in serializer.errors.items()}
                checked.append({**row, "errors": errors})
                continue
            data = serializer.validated_data
            identity = (
                data["category"].casefold(),
                data["currency"],
                data["name"].casefold(),
                data["variant_name"].casefold(),
            )
            if identity in seen_identity:
                errors["name"] = "Bu mahsulot va variant faylda takrorlangan."
            seen_identity.add(identity)
            if data["barcode"]:
                if data["barcode"] in seen_barcodes or data["barcode"] in barcodes:
                    errors["barcode"] = "Shtrix-kod faylda yoki katalogda allaqachon mavjud."
                seen_barcodes.add(data["barcode"])
            matches = [
                category
                for category in categories
                if category.name.casefold() == data["category"].casefold() and category.currency == data["currency"]
            ]
            if len(matches) > 1:
                errors["category"] = "Bir xil nomli kategoriyalar bor; avval ularning nomlarini farqlang."
            elif matches and not matches[0].is_active:
                errors["category"] = "Kategoriya arxivlangan; avval faol kategoriya tanlang."
            elif not matches and not allowed["catalog.add_category"]:
                errors["category"] = "Yangi kategoriya yaratishga ruxsat yo‘q."
            if identity[:3] in seen_products and not allowed["catalog.change_product"]:
                errors["variant_name"] = "Qo‘shimcha variant uchun tahrirlash ruxsati kerak."
            seen_products.add(identity[:3])
            existing = [
                p
                for p in products
                if matches and p.category_id == matches[0].pk and p.name.casefold() == data["name"].casefold()
            ]
            if len(existing) > 1:
                errors["name"] = "Bir xil nomli mahsulotlar bor; avval ularni farqlang."
            elif existing:
                if not existing[0].is_active or any(
                    v.name.casefold() == data["variant_name"].casefold() for v in existing[0].variants.all()
                ):
                    errors["name"] = "Bu mahsulot varianti allaqachon mavjud. Import mavjud tovarlarni o‘zgartirmaydi."
                elif not allowed["catalog.change_product"]:
                    errors["name"] = "Mavjud mahsulotga variant qo‘shishga ruxsat yo‘q."
            if data["quantity"] > 0 and not allowed["inventory.add_stock_intake"]:
                errors["quantity"] = "Boshlang‘ich qoldiq uchun ombor kirimi ruxsati kerak."
            if data["quantity"] > 0 and "cost_price" not in row["data"]:
                errors["cost_price"] = "Qoldiq kiritilsa tannarxni kiriting (0 ham mumkin)."
            checked.append({**row, "errors": errors})
        return checked

    @classmethod
    def preview(cls, *, upload, tenant, user):
        rows = read_import_file(upload)
        headers = [HEADERS.get(str(h).strip().lower().replace(" ", "_"), str(h).strip().lower()) for h in rows[0]]
        allowed = set(ImportRowSerializer().fields)
        if len(set(headers)) != len(headers) or any(header not in allowed for header in headers):
            raise ValidationError("Ustun nomlari shablonga mos bo‘lishi va takrorlanmasligi kerak.")
        if not {"name", "category", "price_recommended"}.issubset(headers):
            raise ValidationError("mahsulot, kategoriya va sotuv_narxi ustunlari majburiy.")
        parsed = []
        for number, values in enumerate(rows[1:], start=2):
            if not any(str(value).strip() for value in values):
                continue
            if len(values) > len(headers):
                raise ValidationError(f"{number}-qatorda ustunlar soni sarlavhadan ko‘p.")
            data = {
                header: str(value).strip() for header, value in zip(headers, values, strict=False) if str(value).strip()
            }
            for field in ("price_partner", "price_min", "price_recommended", "quantity", "cost_price"):
                if field in data:
                    data[field] = data[field].replace(" ", "").replace("\u00a0", "").replace(",", ".")
            parsed.append({"row_number": number, "data": data})
        if not parsed:
            raise ValidationError("Faylda mahsulot qatorlari yo‘q.")
        checked = cls.check_rows(parsed, tenant, user)
        return CatalogImportJob.objects.create(
            tenant=tenant, created_by=user, rows=checked, expires_at=timezone.now() + timedelta(hours=1)
        )

    @classmethod
    @transaction.atomic
    def commit(cls, *, job_id, tenant, user, request=None):
        Tenant.objects.select_for_update().get(pk=tenant.pk)
        job = CatalogImportJob.objects.select_for_update().get(pk=job_id, tenant=tenant, created_by=user)
        if job.completed_at:
            return job.result
        if job.expires_at <= timezone.now():
            raise ValidationError("Ko‘rib chiqish muddati tugadi. Faylni qayta yuklang.")
        checked = cls.check_rows(job.rows, tenant, user)
        if any(row["errors"] for row in checked):
            raise ValidationError({"detail": "Xatoli qatorlar bor. Faylni tuzatib qayta tekshiring.", "rows": checked})
        created_ids = []
        for row in checked:
            serializer = ImportRowSerializer(data=row["data"])
            serializer.is_valid(raise_exception=True)
            data = dict(serializer.validated_data)
            category = Category.objects.filter(
                tenant=tenant, name__iexact=data.pop("category"), currency=data.pop("currency")
            ).first()
            if category is None:
                category = CategoryService.create(
                    tenant=tenant, name=row["data"]["category"], currency=row["data"].get("currency", "UZS")
                )
            name = data.pop("name")
            quantity = data.pop("quantity")
            cost_price = data.pop("cost_price")
            batch_code = data.pop("batch_code")
            expires_on = data.pop("expires_on", None)
            variant_name = data.pop("variant_name")
            product = Product.objects.filter(tenant=tenant, category=category, name__iexact=name).first()
            if product is None:
                product = ProductService.create(
                    tenant=tenant, name=name, category=category, variant_name=variant_name, **data
                )
                variant = product.variants.get()
            else:
                variant = ProductService.add_variant(product=product, name=variant_name, **data)
            if quantity > 0:
                StockService.intake(
                    tenant=tenant,
                    product_variant=variant,
                    quantity=quantity,
                    cost_price=cost_price,
                    created_by=user,
                    note=f"Fayldan import #{job.pk}",
                    batch_code=batch_code,
                    expires_on=expires_on,
                )
            created_ids.append(variant.pk)
        job.completed_at = timezone.now()
        job.result = {"created_count": len(created_ids), "variant_ids": created_ids}
        job.save(update_fields=["completed_at", "result", "updated_at"])
        from apps.core.services.audit_service import AuditService

        AuditService.log(
            action="catalog_import",
            actor=user,
            tenant=tenant,
            target_model="CatalogImportJob",
            target_id=str(job.pk),
            changes=job.result,
            description="Katalog fayldan import qilindi",
            request=request,
        )
        return job.result
