from decimal import Decimal
from functools import wraps
import logging

from django.db import IntegrityError, transaction
from django.db.models import Prefetch, Q
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from api.query_params import positive_id, nonnegative_price
from api.permissions import HasEmployeePermission
from api.schema import ImageUploadInputSerializer, optional_pagination
from api.v1.catalog.serializers import (
    ProductCreateSerializer,
    ProductImageSerializer,
    ProductOutputSerializer,
    ProductUpdateSerializer,
    ProductVariantCreateSerializer,
    ProductVariantOutputSerializer,
    ProductVariantUpdateSerializer,
)
from apps.accounts.services.permission_service import PermissionService
from apps.catalog.models import Product, ProductVariant
from apps.catalog.services import ProductService, ProductServiceError
from apps.inventory.services import StockServiceError

from ._base import CatalogAPIView

logger = logging.getLogger(__name__)


def catalog_integrity_response(method):
    @wraps(method)
    def wrapped(*args, **kwargs):
        try:
            with transaction.atomic():
                from apps.tenants.models import Tenant
                Tenant.objects.select_for_update().get(pk=args[0].tenant.pk)
                return method(*args, **kwargs)
        except IntegrityError:
            return Response({"detail": "Variant nomi yoki shtrix-kod allaqachon mavjud."}, status=400)
    return wrapped


def variant_has_history(variant):
    return variant.sale_items.exists() or variant.transfer_source_lines.exists() or variant.received_b2b_sale_items.exists() or variant.stock_movements.exists()


class ProductListCreateView(CatalogAPIView):
    """GET  /api/v1/catalog/products/
    POST /api/v1/catalog/products/ -- creates the Product AND its
    mandatory first ProductVariant in one call."""

    parser_classes = [MultiPartParser, FormParser, JSONParser]
    history_model = Product
    permission_classes = [HasEmployeePermission]
    permission_map = {"GET": "catalog.view_product", "POST": "catalog.add_product"}

    @extend_schema(request=None, responses={200: optional_pagination(ProductOutputSerializer)})
    def get(self, request):
        archived = request.query_params.get("archived")
        is_archived = archived and archived.lower() in ("true", "1")

        variant_prefetch = Prefetch(
            "variants",
            queryset=(
                ProductVariant.objects.all()
                if is_archived
                else ProductVariant.objects.filter(is_active=True)
            ).select_related("stock").prefetch_related("stock_batches"),
        )

        qs = (
            Product.objects.filter(tenant=self.tenant, is_active=not is_archived)
            .select_related("category")
            .prefetch_related(variant_prefetch, "gallery_images")
        )
        search = request.query_params.get("search")
        if search:
            search = search.strip()
            qs = qs.filter(
                Q(name__icontains=search)
                | Q(variants__name__icontains=search)
                | Q(variants__sku__icontains=search)
                | Q(variants__code__icontains=search)
                | Q(variants__barcode__icontains=search)
            ).distinct()

        category_id = positive_id(request.query_params.get("category"), "category")
        if category_id:
            qs = qs.filter(category_id=category_id)

        if request.query_params.get("page"):
            from api.pagination import StandardResultsSetPagination
            paginator = StandardResultsSetPagination()
            page_data = paginator.paginate_queryset(qs, request)
            return paginator.get_paginated_response(
                ProductOutputSerializer(page_data, many=True, context={"request": request}).data
            )

        return Response(
            ProductOutputSerializer(qs, many=True, context={"request": request}).data
        )

    @extend_schema(request=ProductCreateSerializer, responses={201: ProductOutputSerializer})
    @transaction.atomic
    def post(self, request):
        serializer = ProductCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        val_data = serializer.validated_data
        initial_quantity = val_data.pop("initial_quantity", None)
        initial_cost_price = val_data.pop("initial_cost_price", None)
        supplier = val_data.pop("supplier", "").strip()
        intake_note = val_data.pop("intake_note", "").strip()
        expires_on = val_data.pop("expires_on", None)
        batch_code = val_data.pop("batch_code", "").strip()

        if initial_quantity and not PermissionService.has_permission(
            request.user, "inventory.add_stock_intake", tenant=self.tenant, employee=self.employee,
        ):
            raise PermissionDenied("Boshlang‘ich qoldiq kiritish uchun ombor kirimi ruxsati kerak.")
        try:
            with transaction.atomic():
                product = ProductService.create(tenant=self.tenant, **val_data)
                if initial_quantity is not None and initial_quantity > 0:
                    from apps.inventory.services import StockService

                    first_variant = product.variants.first()
                    note_parts = []
                    if supplier:
                        note_parts.append(f"Ta’minotchi: {supplier}")
                    if intake_note:
                        note_parts.append(intake_note)
                    combined_note = " | ".join(note_parts) if note_parts else "Boshlang‘ich kirim"

                    StockService.intake(
                        tenant=self.tenant,
                        product_variant=first_variant,
                        quantity=initial_quantity,
                        cost_price=initial_cost_price if initial_cost_price is not None else Decimal("0"),
                        created_by=request.user,
                        note=combined_note,
                        batch_code=batch_code,
                        expires_on=expires_on,
                        supplier=supplier,
                    )
        except (ProductServiceError, StockServiceError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response({"detail": "Variant nomi yoki shtrix-kod allaqachon mavjud."}, status=400)

        # Re-fetch product with stock pre-fetched to output accurate stock_quantity
        product = (
            Product.objects.filter(tenant=self.tenant, pk=product.pk)
            .select_related("category")
            .prefetch_related("variants", "gallery_images")
            .first()
        )

        return Response(
            ProductOutputSerializer(product, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class ProductDetailView(CatalogAPIView):
    """GET   /api/v1/catalog/products/{pk}/
    PATCH /api/v1/catalog/products/{pk}/ -- edits the Product's own
    fields only (name/category/image), never its variants."""

    history_model = Product
    permission_classes = [HasEmployeePermission]
    permission_map = {
        "GET": "catalog.view_product",
        "PATCH": "catalog.change_product",
        "DELETE": "catalog.archive_product",
    }
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @extend_schema(request=None, responses={200: ProductOutputSerializer})
    def get(self, request, pk):
        product = get_object_or_404(
            Product.objects.prefetch_related("variants"), pk=pk, tenant=self.tenant
        )
        return Response(ProductOutputSerializer(product, context={"request": request}).data)

    @extend_schema(request=ProductUpdateSerializer, responses={200: ProductOutputSerializer})
    @catalog_integrity_response
    def patch(self, request, pk):
        product = get_object_or_404(Product, pk=pk, tenant=self.tenant)
        serializer = ProductUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        category = values.pop("category", None)
        if category is not None and (category.tenant_id != self.tenant.id or not category.is_active):
            return Response({"detail": "Faol kategoriya shu do‘konga tegishli bo‘lishi kerak."}, status=400)
        if category is not None and category.currency != product.category.currency and (product.variants.filter(stock__quantity__gt=0).exists() or any(variant_has_history(v) for v in product.variants.all())):
            return Response({"detail": "Qoldig‘i bor mahsulot valyutasini o‘zgartirib bo‘lmaydi."}, status=400)
        variant_id = values.pop("variant_id", None)
        fields = {key: values.pop(key) for key in (
            "unit", "code", "barcode", "mxik", "package_code", "price_partner", "price_min", "price_recommended",
        ) if key in values}
        variant = get_object_or_404(product.variants, pk=variant_id) if variant_id is not None else product.variants.first()
        if variant is not None and "unit" in fields and fields["unit"] != variant.unit and variant_has_history(variant):
            return Response({"detail": "Harakat tarixi bor variant o‘lchov birligini o‘zgartirib bo‘lmaydi."}, status=400)
        try:
            with transaction.atomic():
                if category is not None:
                    product.category = category
                for key, value in values.items():
                    setattr(product, key, value)
                product.save()
                if fields and variant is not None:
                    old = {key: getattr(variant, key) for key in fields}
                    for key, value in fields.items():
                        setattr(variant, key, (value or None) if key == "barcode" else value)
                    variant.save()
                    changes = {key: {"old": str(old[key]), "new": str(getattr(variant, key))}
                               for key in fields if key.startswith("price_") and old[key] != getattr(variant, key)}
                    if changes:
                        from apps.core.models import AuditAction
                        from apps.core.services.audit_service import AuditService
                        AuditService.log(action=AuditAction.PRICE_CHANGE, actor=request.user, tenant=self.tenant,
                                         target_model="ProductVariant", target_id=str(variant.pk), changes=changes, request=request)
        except IntegrityError:
            return Response({"detail": "Variant nomi yoki shtrix-kod allaqachon mavjud."}, status=400)
        return Response(ProductOutputSerializer(product, context={"request": request}).data)

    @extend_schema(request=None, responses={204: None})
    def delete(self, request, pk):
        product = get_object_or_404(Product, pk=pk, tenant=self.tenant)
        try:
            ProductService.delete(product)
        except ProductServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProductArchiveView(CatalogAPIView):
    """POST /api/v1/catalog/products/{pk}/archive/ -- cascades to every
    variant of this product (see ProductService.archive())."""

    history_model = Product
    permission_classes = [HasEmployeePermission]
    required_permission = "catalog.archive_product"

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: ProductOutputSerializer})
    def post(self, request, pk):
        product = get_object_or_404(Product, pk=pk, tenant=self.tenant)
        product = ProductService.archive(product)
        return Response(ProductOutputSerializer(product, context={"request": request}).data)


class ProductUnarchiveView(CatalogAPIView):
    """POST /api/v1/catalog/products/{pk}/unarchive/ -- restores product
    and all its variants (see ProductService.unarchive())."""

    history_model = Product
    permission_classes = [HasEmployeePermission]
    required_permission = "catalog.archive_product"

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: ProductOutputSerializer})
    def post(self, request, pk):
        product = get_object_or_404(Product, pk=pk, tenant=self.tenant)
        product = ProductService.unarchive(product)
        return Response(ProductOutputSerializer(product, context={"request": request}).data)


class ProductVariantCreateView(CatalogAPIView):
    """POST /api/v1/catalog/products/{product_id}/variants/ -- adds an
    additional variant (e.g. a new size/colour) to an existing product.
    Gated on "change_product", per the consolidated permission model --
    a variant has no permission of its own (9-bosqich)."""

    history_model = ProductVariant
    permission_classes = [HasEmployeePermission]
    required_permission = "catalog.change_product"
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @extend_schema(request=ProductVariantCreateSerializer, responses={201: ProductVariantOutputSerializer})
    def post(self, request, product_id):
        product = get_object_or_404(Product, pk=product_id, tenant=self.tenant)
        serializer = ProductVariantCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            variant = ProductService.add_variant(product=product, **serializer.validated_data)
        except ProductServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            ProductVariantOutputSerializer(variant, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class ProductVariantDetailView(CatalogAPIView):
    """PATCH /api/v1/catalog/variants/{pk}/ -- edits a single variant's
    own fields (price, code, barcode, unit, image, name). Also gated on
    "change_product" for the same reason as above."""

    history_model = ProductVariant
    permission_classes = [HasEmployeePermission]
    permission_map = {
        "PATCH": "catalog.change_product",
        "DELETE": "catalog.archive_product",
    }
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @extend_schema(request=ProductVariantUpdateSerializer, responses={200: ProductVariantOutputSerializer})
    @transaction.atomic
    @catalog_integrity_response
    def patch(self, request, pk):
        variant = get_object_or_404(ProductVariant, pk=pk, tenant=self.tenant)
        serializer = ProductVariantUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        if "unit" in data and data["unit"] != variant.unit and variant_has_history(variant):
            return Response({"detail": "Harakat tarixi bor variant o‘lchov birligini o‘zgartirib bo‘lmaydi."}, status=400)
        if "barcode" in data:
            # Never persist "" for "no barcode" -- see ProductVariant.barcode.
            data["barcode"] = data["barcode"] or None

        price_fields = ("price_partner", "price_min", "price_recommended")
        old_prices = {f: getattr(variant, f) for f in price_fields}

        for field, value in data.items():
            setattr(variant, field, value)
        variant.save()

        price_changes = {}
        for f in price_fields:
            if f in data and old_prices[f] != getattr(variant, f):
                price_changes[f] = {"old": str(old_prices[f]), "new": str(getattr(variant, f))}

        if price_changes:
            from apps.core.models import AuditAction
            from apps.core.services.audit_service import AuditService
            AuditService.log(
                action=AuditAction.PRICE_CHANGE,
                actor=request.user,
                tenant=self.tenant,
                target_model="ProductVariant",
                target_id=str(variant.id),
                changes=price_changes,
                description=f"Prices changed for variant '{variant.name}'",
                request=request,
            )

        return Response(ProductVariantOutputSerializer(variant, context={"request": request}).data)

    @extend_schema(request=None, responses={204: None})
    def delete(self, request, pk):
        variant = get_object_or_404(ProductVariant, pk=pk, tenant=self.tenant)
        try:
            ProductService.delete_variant(variant)
        except ProductServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_204_NO_CONTENT)



class ProductVariantArchiveView(CatalogAPIView):
    """POST /api/v1/catalog/variants/{pk}/archive/ -- archives ONE
    variant without touching its Product or sibling variants (e.g.
    discontinuing just one colour). The reverse (Product -> all
    variants) is ProductService.archive(); this is the single-variant
    complement, not explicitly discussed in the roadmap but a direct,
    low-risk consequence of variants being independently sellable
    units."""

    history_model = ProductVariant
    permission_classes = [HasEmployeePermission]
    required_permission = "catalog.archive_product"

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: ProductVariantOutputSerializer})
    def post(self, request, pk):
        variant = get_object_or_404(ProductVariant, pk=pk, tenant=self.tenant)
        variant.is_active = False
        variant.save(update_fields=["is_active"])
        return Response(ProductVariantOutputSerializer(variant, context={"request": request}).data)


class ProductVariantUnarchiveView(CatalogAPIView):
    """POST /api/v1/catalog/variants/{pk}/unarchive/ -- restores ONE
    variant and ensures its parent Product is active."""

    history_model = ProductVariant
    permission_classes = [HasEmployeePermission]
    required_permission = "catalog.archive_product"

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: ProductVariantOutputSerializer})
    def post(self, request, pk):
        variant = get_object_or_404(ProductVariant, pk=pk, tenant=self.tenant)
        variant = ProductService.unarchive_variant(variant)
        return Response(ProductVariantOutputSerializer(variant, context={"request": request}).data)


class ProductImageUploadView(CatalogAPIView):
    """POST /api/v1/catalog/products/{pk}/images/ -- uploads an image (up to 3 max)."""
    history_model = Product
    permission_classes = [HasEmployeePermission]
    required_permission = "catalog.change_product"
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(request=ImageUploadInputSerializer, responses={201: ProductImageSerializer})
    def post(self, request, pk):
        product = get_object_or_404(Product, pk=pk, tenant=self.tenant)
        image_file = request.FILES.get("image")
        if not image_file:
            return Response(
                {"error": {"code": "image_required", "message": "'image' fayli talab qilinadi."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            order = int(request.data.get("order", 0))
        except (ValueError, TypeError):
            order = 0

        try:
            prod_image = ProductService.add_image(product=product, image_file=image_file, order=order)
            return Response(
                ProductImageSerializer(prod_image, context={"request": request}).data,
                status=status.HTTP_201_CREATED,
            )
        except ProductServiceError as exc:
            return Response(
                {"error": {"code": "image_error", "message": str(exc)}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:
            logger.error('Product image upload failed: product_id=%s error=%s', product.pk, type(exc).__name__)
            return Response(
                {"error": {"code": "image_error", "message": "Rasmni yuklab bo‘lmadi. Rasm faylini tekshirib, qayta urinib ko‘ring."}},
                status=status.HTTP_400_BAD_REQUEST,
            )


class ProductImageDeleteView(CatalogAPIView):
    """DELETE /api/v1/catalog/products/{pk}/images/{image_id}/ -- deletes a gallery image."""
    history_model = Product
    permission_classes = [HasEmployeePermission]
    required_permission = "catalog.change_product"

    @extend_schema(request=None, responses={204: None})
    def delete(self, request, pk, image_id):
        product = get_object_or_404(Product, pk=pk, tenant=self.tenant)
        try:
            ProductService.remove_image(product=product, image_id=image_id)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except ProductServiceError as exc:
            return Response(
                {"error": {"code": "not_found", "message": str(exc)}},
                status=status.HTTP_404_NOT_FOUND,
            )

class ProductVariantListView(CatalogAPIView):
    """
    GET /api/v1/catalog/variants/
    POS va savdo uchun tovar variantlarini qidirish va filterlash.
    Filtrlar:
      - search: nomi, mahsulot nomi, sku, code, barcode bo'yicha qidiruv
      - barcode: shtrix-kod bo'yicha aniq qidiruv
      - sku: SKU bo'yicha qidiruv
      - category: kategoriya ID si
      - currency: UZS / USD
      - min_price, max_price: narxlar oralig'i (price_min bo'yicha)
      - in_stock: true bo'lsa faqat omborda mavjud tovarlar (quantity > 0)
      - archived: true bo'lsa faqat arxivlangan tovarlar
    """
    permission_classes = [HasEmployeePermission]
    required_permission = "catalog.view_product"

    @extend_schema(request=None, responses={200: optional_pagination(ProductVariantOutputSerializer)})
    def get(self, request):
        archived = request.query_params.get("archived")
        if archived and archived.lower() in ("true", "1"):
            qs = (
                ProductVariant.objects.filter(tenant=self.tenant)
                .filter(Q(is_active=False) | Q(product__is_active=False))
                .select_related("product", "product__category", "stock")
                .prefetch_related("stock_batches", "product__gallery_images")
            )
        else:
            qs = (
                ProductVariant.objects.filter(
                    tenant=self.tenant, is_active=True, product__is_active=True
                )
                .select_related("product", "product__category", "stock")
                .prefetch_related("stock_batches", "product__gallery_images")
            )

        ids = request.query_params.get("ids")
        if ids is not None:
            selected_ids = serializers.ListField(
                child=serializers.IntegerField(min_value=1), max_length=1000
            ).run_validation(ids.split(",") if ids else [])
            qs = qs.filter(pk__in=selected_ids)

        for param, field in (("product_name", "product__name__iexact"), ("variant_name", "name__iexact")):
            if request.query_params.get(param):
                qs = qs.filter(**{field: request.query_params[param].strip()})

        barcodes = request.query_params.get("barcodes")
        if barcodes is not None:
            values = serializers.ListField(child=serializers.CharField(max_length=64), max_length=1000).run_validation(
                barcodes.split(",") if barcodes else []
            )
            qs = qs.filter(barcode__in=values)

        lookup = request.query_params.get("lookup")
        if lookup:
            value = lookup.strip()
            qs = qs.filter(Q(barcode__iexact=value) | Q(code__iexact=value) | Q(sku__iexact=value))

        in_stock = request.query_params.get("in_stock")
        if in_stock and in_stock.lower() in ("true", "1"):
            qs = qs.filter(stock__quantity__gt=Decimal("0.000"))

        search = request.query_params.get("search")
        if search:
            search = search.strip()
            qs = qs.filter(
                Q(name__icontains=search)
                | Q(product__name__icontains=search)
                | Q(sku__icontains=search)
                | Q(code__icontains=search)
                | Q(barcode__icontains=search)
            )

        barcode = request.query_params.get("barcode")
        if barcode:
            qs = qs.filter(barcode=barcode.strip())

        sku = request.query_params.get("sku")
        if sku:
            qs = qs.filter(sku__iexact=sku.strip())

        category_id = positive_id(request.query_params.get("category"), "category")
        if category_id:
            qs = qs.filter(product__category_id=category_id)

        currency = request.query_params.get("currency")
        if currency:
            qs = qs.filter(product__category__currency=currency.upper())

        min_price = request.query_params.get("min_price")
        if min_price:
            qs = qs.filter(price_min__gte=nonnegative_price(min_price, "min_price"))

        max_price = request.query_params.get("max_price")
        if max_price:
            qs = qs.filter(price_min__lte=nonnegative_price(max_price, "max_price"))

        ordered_qs = qs.distinct().order_by("id")
        if request.query_params.get("page"):
            from api.pagination import StandardResultsSetPagination
            paginator = StandardResultsSetPagination()
            page_data = paginator.paginate_queryset(ordered_qs, request)
            return paginator.get_paginated_response(
                ProductVariantOutputSerializer(page_data, many=True, context={"request": request}).data
            )

        return Response(
            ProductVariantOutputSerializer(ordered_qs, many=True, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )
