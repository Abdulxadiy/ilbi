"""A paginated timeline of existing business records and immutable edits."""

from datetime import datetime, time
from zoneinfo import ZoneInfo

from django.db.models import CharField, F, Q, Value

from apps.cashbox.models import CashExpense, CashIncome, CashShift, DailyCashReport
from apps.core.models import AuditAction, AuditLog
from apps.core.audit_privacy import safe_audit_data, safe_audit_text
from apps.inventory.models import StockMovement
from apps.sales.models import DebtPayment, Sale

TASHKENT = ZoneInfo("Asia/Tashkent")
CATALOG = Q(target_model__in=["Product", "ProductVariant", "Category", "ProductImage"]) | Q(
    action__in=[AuditAction.CATALOG_IMPORT, AuditAction.BARCODE_GENERATE, AuditAction.PRICE_CHANGE],
)
SALES = Q(target_model__in=["Sale", "SaleItem"]) | Q(action__startswith="b2b_")
INVENTORY = Q(target_model__in=["StockMovement", "Stock", "TenantTransfer"]) | Q(action__startswith="tenant_transfer_")
TEAM = Q(action__startswith="employee_") | Q(action=AuditAction.OWNER_TRANSFER)
FINANCE = Q(action__in=[AuditAction.CASH_DISCREPANCY, AuditAction.COUNTERPARTY_IMPORT]) | Q(
    target_model__in=["CashShift", "DailyCashReport", "CashIncome", "CashExpense", "DebtPayment"],
)
AUDIT_GROUPS = {
    "catalog": CATALOG,
    "sales": SALES,
    "inventory": INVENTORY,
    "team": TEAM,
    "finance": FINANCE,
    "settings": ~(CATALOG | SALES | INVENTORY | TEAM | FINANCE),
}

ACTION_LABELS = {
    "catalog_create": "Tovar qo‘shildi",
    "catalog_update": "Tovar tahrirlandi",
    "catalog_archive": "Tovar arxivlandi",
    "catalog_restore": "Tovar tiklandi",
    "catalog_delete": "Tovar o‘chirildi",
    "price_change": "Narx o‘zgartirildi",
    "catalog_import": "Katalog fayldan yuklandi",
    "counterparty_import": "Mijozlar fayldan yuklandi",
    "barcode_generate": "Shtrix-kod yaratildi",
    "void_sale": "Sotuv qaytarildi",
    "stock_adjustment": "Ombor qoldig‘i tuzatildi",
    "employee_hire": "Xodim qo‘shildi",
    "employee_fire": "Xodim bo‘shatildi",
    "employee_update": "Xodim tahrirlandi",
    "employee_block": "Xodim bloklandi",
    "employee_unblock": "Xodim blokdan chiqarildi",
    "employee_archive": "Xodim arxivlandi",
    "employee_restore": "Xodim tiklandi",
    "employee_invite": "Taklif havolasi yuborildi",
    "owner_transfer": "Do‘kon egasi o‘zgartirildi",
    "tenant_create": "Do‘kon yaratildi",
    "tenant_update": "Do‘kon sozlamalari yangilandi",
    "cash_discrepancy": "Kassa tafovuti qayd etildi",
    "login_attempt": "Tizimga kirish",
    "password_reset": "Parol yangilandi",
    "receipt_token_rotate": "Chek havolasi yangilandi",
    "seller_profile_submit": "Sotuvchi profili yuborildi",
    "seller_profile_review": "Sotuvchi profili tekshirildi",
    "seller_profile_binding": "Sotuvchi profili bog‘landi",
    "tenant_transfer_dispatch": "Tovar transferi jo‘natildi",
    "tenant_transfer_receive": "Tovar transferi qabul qilindi",
    "tenant_transfer_discrepancy": "Transfer tafovuti qayd etildi",
    "tenant_transfer_return": "Tovar transferi qaytdi",
    "b2b_return_pending": "B2B qaytarish kutilmoqda",
    "b2b_return_receive": "B2B qaytarish qabul qilindi",
    "b2b_return_discrepancy_close": "B2B tafovuti yopildi",
    "account_identity_update": "Hisob ma’lumotlari yangilandi",
    "support_telegram_settings": "Bildirishnomalar sozlandi",
}


def history_sources(tenant_id=None, filters=None):
    filters = filters or {}
    # A sale appears once, rather than once for each stock row on its receipt.
    sources = {
        "sale": (
            Sale.objects.select_related("tenant", "sold_by", "counterparty"),
            "created_at",
            "sold_by",
            "sales",
            [
                "receipt_number",
                "counterparty__name",
                "items__product_snapshot__product_name",
                "items__product_variant__product__name",
            ],
        ),
        "stock": (
            StockMovement.objects.exclude(
                sale__isnull=False,
                type__in=[StockMovement.TYPE_SOTUV, StockMovement.TYPE_SALE_RESTORE, StockMovement.TYPE_MIJOZ_QAYTARDI],
            ).select_related("tenant", "created_by", "product_variant__product__category"),
            "created_at",
            "created_by",
            "inventory",
            ["product_variant__product__name", "product_variant__name", "note"],
        ),
        "audit": (
            AuditLog.objects.exclude(action=AuditAction.STOCK_ADJUSTMENT, target_model="StockMovement").select_related(
                "tenant", "actor"
            ),
            "created_at",
            "actor",
            None,
            ["description", "target_model", "action"],
        ),
        "debt": (
            DebtPayment.objects.select_related("tenant", "recorded_by", "counterparty"),
            "paid_at",
            "recorded_by",
            "finance",
            ["counterparty__name", "note"],
        ),
        "income": (
            CashIncome.objects.select_related("tenant", "recorded_by"),
            "created_at",
            "recorded_by",
            "finance",
            ["source", "note"],
        ),
        "expense": (
            CashExpense.objects.select_related("tenant", "recorded_by"),
            "created_at",
            "recorded_by",
            "finance",
            ["category", "note"],
        ),
        "shift_open": (
            CashShift.objects.select_related("tenant", "opened_by"),
            "opened_at",
            "opened_by",
            "finance",
            [],
        ),
        "shift_close": (
            DailyCashReport.objects.select_related("tenant", "closed_by"),
            "closed_at",
            "closed_by",
            "finance",
            ["discrepancy_reason"],
        ),
    }
    result = {}
    for source, (qs, when, actor, category, search_fields) in sources.items():
        selected = filters.get("category", "all")
        if selected != "all":
            if source == "audit":
                if selected not in AUDIT_GROUPS:
                    continue
                qs = qs.filter(AUDIT_GROUPS[selected])
            elif selected != category:
                continue
        if tenant_id is not None:
            qs = qs.filter(tenant_id=tenant_id)
        if filters.get("actor"):
            qs = qs.filter(**{f"{actor}_id": filters["actor"]})
        search = filters.get("search", "").strip()
        if search:
            condition = Q()
            for field in search_fields + [f"{actor}__first_name", f"{actor}__last_name", f"{actor}__username"]:
                condition |= Q(**{f"{field}__icontains": search})
            qs = qs.filter(condition).distinct()
        if filters.get("date_from"):
            qs = qs.filter(**{f"{when}__gte": datetime.combine(filters["date_from"], time.min, TASHKENT)})
        if filters.get("date_to"):
            end = datetime.combine(filters["date_to"], time.max, TASHKENT)
            qs = qs.filter(**{f"{when}__lte": end})
        result[source] = (qs, when, actor, category)
    return result


def timeline_queryset(sources):
    projections = [
        qs.order_by()
        .annotate(
            history_source=Value(source, output_field=CharField()),
            history_id=F("pk"),
            history_time=F(when),
        )
        .values("history_source", "history_id", "history_time")
        for source, (qs, when, _, _) in sources.items()
    ]
    return projections[0].union(*projections[1:], all=True).order_by("-history_time", "history_source", "-history_id")


def _audit_category(obj):
    if obj.target_model in ("Product", "ProductVariant", "Category", "ProductImage") or obj.action in (
        AuditAction.CATALOG_IMPORT,
        AuditAction.BARCODE_GENERATE,
        AuditAction.PRICE_CHANGE,
    ):
        return "catalog"
    if obj.target_model in ("Sale", "SaleItem") or obj.action.startswith("b2b_"):
        return "sales"
    if obj.target_model in ("StockMovement", "Stock", "TenantTransfer") or obj.action.startswith("tenant_transfer_"):
        return "inventory"
    if obj.action.startswith("employee_") or obj.action == AuditAction.OWNER_TRANSFER:
        return "team"
    if obj.action == AuditAction.CASH_DISCREPANCY or obj.target_model in (
        "CashShift",
        "DailyCashReport",
        "CashIncome",
        "CashExpense",
        "DebtPayment",
    ):
        return "finance"
    return "settings"


def history_event(source, obj, spec):
    _, when, actor_field, category = spec
    actor = getattr(obj, actor_field)
    data = {
        "id": f"{source}:{obj.pk}",
        "source": source,
        "object_id": obj.pk,
        "created_at": getattr(obj, when).isoformat(),
        "tenant_id": obj.tenant_id,
        "tenant_name": obj.tenant.name if obj.tenant_id else "Platforma",
        "actor_id": actor.pk if actor else None,
        "actor_name": (actor.get_full_name() or actor.username) if actor else "Tizim",
        "category": category,
        "amount": None,
        "currency": "",
        "quantity": None,
        "unit": "",
        "reference": f"#{obj.pk}",
        "subtitle": "",
        "status": "",
        "sale_id": None,
    }
    if source == "sale":
        data.update(
            title="Sotuv amalga oshirildi",
            subtitle=obj.counterparty.name if obj.counterparty_id else "Chakana savdo",
            amount=str(obj.total_amount),
            currency=obj.currency,
            reference=obj.receipt_number,
            status=obj.get_status_display(),
            sale_id=obj.pk,
        )
    elif source == "stock":
        variant = obj.product_variant
        data.update(
            title="Tovar kirim qilindi" if obj.type == StockMovement.TYPE_KIRIM else obj.get_type_display(),
            subtitle=f"{variant.product.name} · {variant.name}",
            quantity=str(obj.quantity),
            unit=variant.unit,
            currency=variant.currency,
            direction=obj.direction,
            status=obj.get_direction_display(),
        )
    elif source == "audit":
        title = ACTION_LABELS.get(obj.action, obj.get_action_display())
        if obj.target_model == "Category" and obj.action.startswith("catalog_"):
            title = title.replace("Tovar", "Kategoriya")
        data.update(
            title=title,
            subtitle=safe_audit_text(obj.description),
            category=_audit_category(obj),
            reference=f"#{obj.target_id}" if obj.target_id else f"#{obj.pk}",
            action=obj.action,
        )
        if obj.target_model == "Sale" and obj.target_id.isdigit():
            data["sale_id"] = int(obj.target_id)
    elif source in ("debt", "income", "expense"):
        title = {
            "debt": "Qarz to‘lovi qabul qilindi",
            "income": "Kassaga kirim qilindi",
            "expense": "Kassadan chiqim qilindi",
        }[source]
        subtitle = obj.counterparty.name if source == "debt" else obj.source if source == "income" else obj.category
        if source == "debt" and obj.is_correction:
            title = "Qarz hisobi tuzatildi"
        data.update(title=title, subtitle=subtitle, amount=str(obj.amount), currency=obj.currency)
    else:
        data.update(title="Smena ochildi" if source == "shift_open" else "Smena yopildi", subtitle="Kassa hisoboti")
    return data


def hydrate_history(rows, sources):
    objects = {}
    for source in {row["history_source"] for row in rows}:
        ids = [row["history_id"] for row in rows if row["history_source"] == source]
        objects[source] = sources[source][0].in_bulk(ids)
    return [
        history_event(
            row["history_source"], objects[row["history_source"]][row["history_id"]], sources[row["history_source"]]
        )
        for row in rows
        if row["history_id"] in objects[row["history_source"]]
    ]


def history_details(source, obj):
    fields = []

    def field(label, value):
        if value is not None and value != "":
            fields.append({"label": label, "value": str(value)})

    changes, snapshot = {}, {}
    if source == "stock":
        variant = obj.product_variant
        field("Tovar", variant.product.name)
        field("Variant", variant.name)
        field("Harakat turi", obj.get_type_display())
        field("Yo‘nalish", obj.get_direction_display())
        field("Miqdor", f"{obj.quantity} {variant.unit}")
        field("Tovar kodi", variant.code)
        field("Valyuta", variant.currency)
        if obj.cost_price is not None:
            field("Birlik tannarxi", obj.cost_price)
            field("Jami tannarx", obj.cost_price * obj.quantity)
    elif source == "audit":
        changes = safe_audit_data(obj.changes or {})
        snapshot = changes.get("snapshot", {})
        changes = {key: value for key, value in changes.items() if key != "snapshot"}
        field(
            "Obyekt",
            {
                "Product": "Tovar",
                "ProductVariant": "Variant",
                "Category": "Kategoriya",
                "Tenant": "Do‘kon",
                "Employee": "Xodim",
                "Sale": "Sotuv",
                "SaleItem": "Sotuv qatori",
                "SellerProfile": "Sotuvchi profili",
                "TenantTransfer": "Tovar transferi",
                "CashShift": "Kassa smenasi",
            }.get(obj.target_model, obj.target_model),
        )
    elif source in ("debt", "income", "expense"):
        field("Summa", f"{obj.amount} {obj.currency}")
        if source == "debt":
            field("Mijoz", obj.counterparty.name)
            field("To‘lov turi", obj.get_payment_type_display())
            field("Hisobda ishlatilgan kurs", obj.exchange_rate)
            field("So‘mga aylantirilgan summa", obj.converted_amount_uzs)
        else:
            field("Manba" if source == "income" else "Chiqim turi", obj.source if source == "income" else obj.category)
    elif source == "shift_open":
        field("Boshlang‘ich qoldiq (UZS)", obj.opening_cash_uzs)
        field("Boshlang‘ich qoldiq (USD)", obj.opening_cash_usd)
    elif source == "shift_close":
        for label, attr in (
            ("Kutilgan qoldiq", "expected_cash"),
            ("Haqiqiy qoldiq", "actual_cash"),
            ("Tafovut", "discrepancy"),
        ):
            for currency in ("uzs", "usd"):
                field(f"{label} ({currency.upper()})", getattr(obj, f"{attr}_{currency}"))
    return {
        "fields": fields,
        "changes": changes,
        "snapshot": snapshot,
        "note": getattr(obj, "note", "") or getattr(obj, "discrepancy_reason", ""),
    }
