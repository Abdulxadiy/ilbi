from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from api.mixins import OwnerStaffOnlyAPIView
from api.permissions import HasEmployeePermission, IsOwner
from api.v1.inventory.views.stock_views import filtered_stock_queryset
from api.v1.sales.serializers import CounterpartyDueQuerySerializer, SaleListQuerySerializer
from api.v1.sales.views.sale_views import SaleListCreateView
from apps.accounts.services.permission_service import PermissionService
from apps.core.spreadsheets import (
    MAX_EXCEL_DATA_ROWS,
    MAX_EXPORT_ROWS,
    MONEY_FORMAT,
    QUANTITY_FORMAT,
    XLSX_MIME,
    excel_response,
)
from apps.inventory.models import Stock
from apps.sales.models import Counterparty
from apps.sales.services.counterparty_queries import filtered_counterparties


class SelectedRowsSerializer(serializers.Serializer):
    ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), max_length=MAX_EXPORT_ROWS, allow_empty=True
    )


class StockExportQuerySerializer(serializers.Serializer):
    scope = serializers.ChoiceField(choices=["filtered", "all"], default="filtered")
    search = serializers.CharField(required=False, allow_blank=True)
    category = serializers.IntegerField(required=False, min_value=1)
    sort = serializers.CharField(required=False)


def export_details(request):
    labels = {
        "search": "Qidiruv",
        "category": "Kategoriya ID",
        "sort": "Saralash",
        "date_from": "Boshlanish sanasi",
        "date_to": "Tugash sanasi",
        "status": "Holat",
        "currency": "Valyuta",
        "payment_type": "To‘lov turi",
        "counterparty_id": "Kontragent ID",
        "balance": "Qarzdorlik filtri",
        "balance_status": "Balans holati",
        "due_status": "Qarz muddati filtri",
        "has_debt": "Faqat qarzdorlar",
        "b2b_only": "Faqat B2B",
    }
    return [(label, request.query_params[key]) for key, label in labels.items() if request.query_params.get(key)]


class SelectedExportView(OwnerStaffOnlyAPIView):
    permission_classes = [IsOwner, HasEmployeePermission]

    def selected(self, request, queryset):
        serializer = SelectedRowsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = set(serializer.validated_data["ids"])
        result = queryset.filter(pk__in=ids)
        if result.count() != len(ids):
            raise ValidationError("Tanlangan qatorlar ushbu do‘konda topilmadi.")
        return result


class StockExportView(SelectedExportView):
    required_permission = "inventory.view_stock"

    @extend_schema(request=SelectedRowsSerializer, responses={(200, XLSX_MIME): OpenApiTypes.BINARY})
    def post(self, request):
        stock = self.selected(
            request, Stock.objects.filter(tenant=self.tenant).select_related("product_variant__product__category")
        )
        return self.export_stock(request, stock)

    @extend_schema(parameters=[StockExportQuerySerializer], responses={(200, XLSX_MIME): OpenApiTypes.BINARY})
    def get(self, request):
        query = StockExportQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        all_stock = query.validated_data["scope"] == "all"
        stock = filtered_stock_queryset(self.tenant, {} if all_stock else request.query_params)
        if all_stock:
            stock = stock.order_by("product_variant__product__name", "pk")
        if stock.count() > MAX_EXCEL_DATA_ROWS:
            raise ValidationError("Excel varag‘i 1 048 575 qatorgacha sig‘adi. Filtrlar orqali alohida yuklang.")
        return self.export_stock(request, stock)

    def export_stock(self, request, stock):
        cost_allowed = PermissionService.has_permission(
            request.user, "catalog.view_cost_price", tenant=self.tenant, employee=self.employee
        )
        headers = ["Mahsulot", "Variant", "Kategoriya", "SKU", "Shtrix-kod", "Birlik", "Qoldiq", "Valyuta"]
        if cost_allowed:
            headers.append("Tannarx")
        headers += ["Mahsulot kodi", "Hamkor narxi", "Minimal narx", "Tavsiya etilgan narx", "Sotuv qiymati", "Holat"]
        if cost_allowed:
            headers.append("Tannarx qiymati")

        def rows():
            for record in stock.iterator(chunk_size=2000):
                v = record.product_variant
                row = [
                    v.product.name,
                    v.name,
                    v.product.category.name,
                    v.sku,
                    v.barcode or "",
                    v.unit,
                    record.quantity,
                    v.currency,
                ]
                if cost_allowed:
                    row.append(record.last_cost_price)
                row += [
                    v.code,
                    v.price_partner,
                    v.price_min,
                    v.price_recommended,
                    record.quantity * v.price_recommended,
                    "Faol" if v.is_active and v.product.is_active else "Arxivlangan",
                ]
                if cost_allowed:
                    row.append(record.quantity * record.last_cost_price if record.last_cost_price is not None else None)
                yield row

        amount_columns = {headers.index("Sotuv qiymati"): "Sotuv qiymati"}
        if cost_allowed:
            amount_columns[headers.index("Tannarx qiymati")] = "Tannarx qiymati"
        formats = {header: MONEY_FORMAT for header in headers if "narx" in header.lower() or "qiymati" in header}
        formats.update({"SKU": "@", "Shtrix-kod": "@", "Mahsulot kodi": "@", "Qoldiq": QUANTITY_FORMAT})
        selected = request.method == "POST"
        all_stock = not selected and request.query_params.get("scope") == "all"
        scope = (
            "Tanlangan qatorlar" if selected else "Butun ombor" if all_stock else "Joriy filtrlarga mos barcha qatorlar"
        )
        notes = [
            ("Sotuv qiymati", "Qoldiq × tavsiya etilgan sotuv narxi. Haqiqiy savdo tushumi emas."),
            ("Kiritilgan mahsulotlar", "Ombor yozuvi mavjud variantlar, jumladan nol qoldiq va arxivlanganlar."),
        ]
        if cost_allowed:
            notes.append(
                (
                    "Tannarx qiymati",
                    "Qoldiq × oxirgi tannarx. Tannarxi belgilanmagan qatorlar jamiga kirmaydi. "
                    "Partiyalar bo‘yicha baholash emas.",
                )
            )
        return excel_response(
            headers,
            rows(),
            "ilbi-stock.xlsx",
            "Ombor",
            formats=formats,
            widths={"Mahsulot": 64, "Variant": 32, "Kategoriya": 28, "Shtrix-kod": 24},
            report={
                "tenant": self.tenant.name,
                "scope": scope,
                "details": [] if selected or all_stock else export_details(request),
                "groups": [
                    {
                        "title": "Qoldiq · o‘lchov birliklari bo‘yicha",
                        "key": 5,
                        "columns": {6: "Qoldiq"},
                        "format": QUANTITY_FORMAT,
                    },
                    {"title": "Ombor qiymati · valyutalar bo‘yicha", "key": 7, "columns": amount_columns},
                ],
                "notes": notes,
            },
        )


class CounterpartyExportView(SelectedExportView):
    required_permission = "sales.manage_counterparty"

    @extend_schema(request=SelectedRowsSerializer, responses={(200, XLSX_MIME): OpenApiTypes.BINARY})
    def post(self, request):
        entries = self.selected(request, Counterparty.objects.filter(tenant=self.tenant))
        return self.export_rows(request, entries)

    @extend_schema(parameters=[CounterpartyDueQuerySerializer], responses={(200, XLSX_MIME): OpenApiTypes.BINARY})
    def get(self, request):
        query = CounterpartyDueQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        entries = filtered_counterparties(self.tenant, request.query_params)
        if entries.count() > MAX_EXPORT_ROWS:
            raise ValidationError("Eksport hajmi oshdi. Filtrni toraytiring.")
        return self.export_rows(request, entries)

    def export_rows(self, request, entries):
        rows = (
            [c.name, c.phone_number, c.debt_balance_uzs, c.debt_balance_usd, c.note]
            for c in entries.order_by("name", "pk").iterator(chunk_size=2000)
        )
        return excel_response(
            ["Kontragent", "Telefon", "Qarz UZS", "Qarz USD", "Izoh"],
            rows,
            "ilbi-debts.xlsx",
            "Qarzdorlik",
            formats={"Telefon": "@", "Qarz UZS": MONEY_FORMAT, "Qarz USD": MONEY_FORMAT},
            widths={"Kontragent": 34, "Telefon": 24, "Izoh": 55},
            report={
                "tenant": self.tenant.name,
                "scope": "Tanlangan qatorlar" if request.method == "POST" else "Joriy filtrlarga mos barcha qatorlar",
                "details": export_details(request) if request.method == "GET" else [],
                "groups": [{"title": "Qarzdorlik jamlanmasi", "columns": {2: "Qarz UZS", 3: "Qarz USD"}}],
                "notes": [
                    (
                        "Balans",
                        "Musbat summa — mijoz qarzi; manfiy summa — mijoz foydasiga balans. Jami — sof balans.",
                    )
                ],
            },
        )


class SalesExportView(SaleListCreateView):
    permission_classes = [IsOwner, HasEmployeePermission]
    http_method_names = ["get", "head", "options"]

    @extend_schema(parameters=[SaleListQuerySerializer], responses={(200, XLSX_MIME): OpenApiTypes.BINARY})
    def get(self, request):
        sales = self.get_queryset(request)
        if sales.count() > MAX_EXPORT_ROWS:
            raise ValidationError("Eksport 20 000 qatordan oshdi. Sana yoki boshqa filtrlarni toraytiring.")
        rows = (
            [
                s.receipt_number,
                s.created_at,
                s.sold_by.get_full_name() or s.sold_by.username,
                s.counterparty.name if s.counterparty_id else "",
                s.get_payment_type_display(),
                s.get_status_display(),
                s.currency,
                s.total_amount,
                s.refunded_amount,
                s.net_amount,
            ]
            for s in sales.prefetch_related(None).order_by("-created_at", "-pk").iterator(chunk_size=2000)
        )
        return excel_response(
            [
                "Chek",
                "Vaqt (Toshkent)",
                "Sotuvchi",
                "Kontragent",
                "To‘lov",
                "Holat",
                "Valyuta",
                "Asl summa",
                "Qaytarilgan",
                "Sof summa",
            ],
            rows,
            "ilbi-sales.xlsx",
            "Savdolar",
            formats={"Chek": "@", "Asl summa": MONEY_FORMAT, "Qaytarilgan": MONEY_FORMAT, "Sof summa": MONEY_FORMAT},
            widths={"Chek": 25, "Vaqt (Toshkent)": 24, "Sotuvchi": 28, "Kontragent": 32, "Holat": 30},
            report={
                "tenant": self.tenant.name,
                "scope": "Joriy filtrlarga mos barcha savdolar",
                "details": export_details(request),
                "groups": [
                    {
                        "title": "Savdolar · valyutalar bo‘yicha",
                        "key": 6,
                        "columns": {7: "Asl summa", 8: "Qaytarilgan", 9: "Sof summa"},
                    }
                ],
                "notes": [
                    (
                        "Hisoblash",
                        "Jamlar fayldagi barcha savdolarni holatidan qat’i nazar qamraydi. "
                        "Sof summa = asl summa − qaytarilgan summa.",
                    )
                ],
            },
        )
