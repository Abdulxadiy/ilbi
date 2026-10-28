import logging
from decimal import Decimal
from datetime import timedelta
from django.utils import timezone
from django.db.models import Sum, F, DecimalField, Q

from apps.sales.models import Sale, SaleItem
from apps.sales.quantities import effective_quantity_expression
from apps.catalog.models import ProductVariant

logger = logging.getLogger(__name__)


class DeficitService:
    """
    Identifies deficit / low-stock product variants:
    Criteria:
      1. Rolling last 30 days sales >= threshold_sales (default: 10)
      2. Current stock <= threshold_stock (default: 5)
    If a new stock intake brings quantity > threshold_stock (e.g. > 5),
    the variant automatically drops out of the deficit list.
    """

    DEFAULT_SALES_THRESHOLD = Decimal('10')
    DEFAULT_STOCK_THRESHOLD = Decimal('5')

    @classmethod
    def get_deficit_variants(
        cls,
        tenant,
        threshold_sales: Decimal = DEFAULT_SALES_THRESHOLD,
        threshold_stock: Decimal = DEFAULT_STOCK_THRESHOLD,
        search_query: str = None,
    ) -> list[dict]:
        thirty_days_ago = timezone.now() - timedelta(days=30)

        valid_sale_statuses = [
            Sale.STATUS_COMPLETED,
            Sale.STATUS_PARTIALLY_VOIDED,
            Sale.STATUS_B2B_ACCEPTED,
            Sale.STATUS_B2B_PARTIALLY_ACCEPTED,
            Sale.STATUS_B2B_RETURN_PENDING,
        ]
        # 1. Aggregate effective sold quantities per product_variant over the last 30 days
        sales_qs = (
            SaleItem.objects.filter(
                sale__tenant=tenant,
                sale__created_at__gte=thirty_days_ago,
                sale__status__in=valid_sale_statuses,
            )
            .values("product_variant_id")
            .annotate(
                total_sold=Sum(
                    effective_quantity_expression(),
                    output_field=DecimalField(max_digits=14, decimal_places=3),
                )
            )
            .filter(total_sold__gte=threshold_sales)
        )

        sold_map = {row["product_variant_id"]: row["total_sold"] for row in sales_qs}
        if not sold_map:
            return []

        variant_ids = list(sold_map.keys())

        # 2. Fetch active ProductVariants
        variants_qs = (
            ProductVariant.objects.filter(
                id__in=variant_ids,
                tenant=tenant,
                is_active=True,
                product__is_active=True,
            )
            .select_related("product", "product__category", "stock")
            .order_by("product__name", "name")
        )

        if search_query:
            q = search_query.strip()
            variants_qs = variants_qs.filter(
                Q(product__name__icontains=q)
                | Q(name__icontains=q)
                | Q(code__icontains=q)
                | Q(barcode__icontains=q)
                | Q(sku__icontains=q)
            )

        deficit_list = []
        for variant in variants_qs:
            stock_obj = getattr(variant, "stock", None)
            current_qty = stock_obj.quantity if stock_obj else Decimal("0.000")

            # Must satisfy: current_stock <= threshold_stock
            if current_qty <= threshold_stock:
                sold_qty = sold_map.get(variant.id, Decimal("0.000"))
                gap = max(Decimal("0.000"), threshold_stock - current_qty)
                is_out_of_stock = current_qty <= Decimal("0.000")

                full_name = variant.product.name
                if variant.name and variant.name.lower() != "standart":
                    full_name = f"{variant.product.name} ({variant.name})"

                deficit_list.append({
                    "id": variant.id,
                    "product_variant_id": variant.id,
                    "product_id": variant.product.id,
                    "product_name": variant.product.name,
                    "variant_name": variant.name,
                    "full_name": full_name,
                    "code": variant.code or "",
                    "barcode": variant.barcode or "",
                    "sku": variant.sku or "",
                    "category_id": variant.product.category_id,
                    "category_name": variant.product.category.name if variant.product.category else "",
                    "unit": variant.unit or "dona",
                    "currency": getattr(variant, "currency", "UZS"),
                    "total_sold_last_month": float(sold_qty),
                    "current_stock": float(current_qty),
                    "threshold_stock": float(threshold_stock),
                    "deficit_gap": float(gap),
                    "status": "out_of_stock" if is_out_of_stock else "critical",
                    "status_label": "Tugagan (0 dona)" if is_out_of_stock else f"Kam qolgan ({current_qty:.0f} {variant.unit})",
                })

        # Sort: first items with lowest stock, then highest 30-day sales
        deficit_list.sort(key=lambda item: (item["current_stock"], -item["total_sold_last_month"]))
        return deficit_list

    @classmethod
    def format_telegram_deficit_report(cls, tenant, deficit_items: list[dict]) -> str:
        now_str = timezone.localtime().strftime("%Y-%m-%d | %H:%M")
        lines = [
            "⚠️ *KAMAYIB QOLGAN TOVARLAR (DEFITSIT HISOBOTI)*",
            f"🏢 *Do'kon:* {tenant.name}",
            f"📅 *Sana:* {now_str}",
            "🔍 *Mezon:* So'nggi 30 kunda 10+ sotilgan, hozirda ≤5 dona qolgan",
            "",
        ]

        if not deficit_items:
            lines.extend([
                "✅ *Kamchilik tovarlar mavjud emas!*",
                "Barcha talabgir mahsulotlarning ombordagi qoldig'i 5 donadan ortiq.",
            ])
            return "\n".join(lines)

        lines.append(f"📦 *KAMCHILIK TOVARLAR (Jami: {len(deficit_items)} ta):*")
        lines.append("")

        for idx, item in enumerate(deficit_items[:25], start=1):
            name = item["full_name"]
            code_str = f" | Kod: `{item['code']}`" if item.get("code") else ""
            sold = item["total_sold_last_month"]
            stock = item["current_stock"]
            unit = item["unit"]

            if stock <= 0:
                stock_str = f"🚨 *0 {unit}* (Tugagan!)"
            else:
                stock_str = f"⚠️ *{stock:.0f} {unit}* qolgan"

            lines.append(f"*{idx}. {name}*{code_str}")
            lines.append(f"   • 30 kundagi sotuv: `{sold:.0f} {unit}`")
            lines.append(f"   • Ombordagi qoldiq: {stock_str}")
            lines.append("")

        if len(deficit_items) > 25:
            lines.append(f"_...va yana {len(deficit_items) - 25} ta kamchilik tovarlar mavjud._")
            lines.append("")

        lines.append("💡 _Omborga tovar kirimi qilinib, qoldiq 5 tadan oshgach, ushbu tovar avtomatik ravishda kamchiliklar ro'yxatidan chiqadi._")
        return "\n".join(lines)
