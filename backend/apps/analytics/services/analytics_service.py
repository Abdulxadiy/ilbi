from decimal import Decimal
from datetime import datetime, time, timedelta
from collections import defaultdict
from django.utils import timezone
from django.db.models import Sum, Q, F, Case, When
from django.db.models.functions import Coalesce

from apps.sales.models import Sale, SaleItem, Counterparty, DebtPayment
from apps.sales.quantities import effective_quantity, effective_quantity_expression
from apps.inventory.models import Stock
from apps.catalog.models import ProductVariant


class AnalyticsServiceError(Exception):
    pass


class AnalyticsService:
    @staticmethod
    def resolve_date_range(period: str = "today", start_date_str: str = None, end_date_str: str = None):
        now = timezone.localtime()
        today = now.date()

        if period == "today":
            start_dt = timezone.make_aware(datetime.combine(today, time.min))
            end_dt = timezone.make_aware(datetime.combine(today, time.max))
        elif period == "this_week":
            # 1 haftalik hisobot: so'nggi 7 kun (bugun va oldingi 6 kun)
            start_of_week = today - timedelta(days=6)
            start_dt = timezone.make_aware(datetime.combine(start_of_week, time.min))
            end_dt = timezone.make_aware(datetime.combine(today, time.max))
        elif period == "this_month":
            start_of_month = today.replace(day=1)
            start_dt = timezone.make_aware(datetime.combine(start_of_month, time.min))
            end_dt = timezone.make_aware(datetime.combine(today, time.max))
        elif period == "this_year":
            start_of_year = today.replace(month=1, day=1)
            start_dt = timezone.make_aware(datetime.combine(start_of_year, time.min))
            end_dt = timezone.make_aware(datetime.combine(today, time.max))
        elif period == "custom":
            if not start_date_str or not end_date_str:
                raise AnalyticsServiceError("custom davr uchun start_date va end_date kiritilishi shart.")
            try:
                s_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
                e_date = datetime.strptime(end_date_str, "%Y-%m-%d").date()
            except ValueError:
                raise AnalyticsServiceError("Sana formati YYYY-MM-DD bo'lishi kerak.")
            if s_date > e_date:
                raise AnalyticsServiceError("start_date end_date dan katta bo'lishi mumkin emas.")
            start_dt = timezone.make_aware(datetime.combine(s_date, time.min))
            end_dt = timezone.make_aware(datetime.combine(e_date, time.max))
        else:
            raise AnalyticsServiceError(f"Noto'g'ri period: {period}. 'today', 'this_week', 'this_month', 'this_year', 'custom' tanlang.")

        return start_dt, end_dt

    @classmethod
    def resolve_previous_date_range(cls, period: str, start_dt, end_dt):
        """
        Determines the corresponding previous period date range:
        - today: yesterday (00:00 - 23:59:59)
        - this_week: the 7 days preceding the current 7-day window
        - this_month: previous calendar month up to the same day
        - this_year: previous calendar year up to the same day
        - custom: equal duration prior to start_dt
        """
        if period == "today":
            prev_start_dt = start_dt - timedelta(days=1)
            prev_end_dt = end_dt - timedelta(days=1)
        elif period == "this_week":
            prev_start_dt = start_dt - timedelta(days=7)
            prev_end_dt = end_dt - timedelta(days=7)
        elif period == "this_month":
            first_of_this_month = start_dt.date()
            last_day_of_prev_month = first_of_this_month - timedelta(days=1)
            first_of_prev_month = last_day_of_prev_month.replace(day=1)
            curr_day = min(end_dt.date().day, last_day_of_prev_month.day)
            prev_end_day = first_of_prev_month.replace(day=curr_day)
            prev_start_dt = timezone.make_aware(datetime.combine(first_of_prev_month, time.min))
            prev_end_dt = timezone.make_aware(datetime.combine(prev_end_day, time.max))
        elif period == "this_year":
            curr_start = start_dt.date()
            curr_end = end_dt.date()
            try:
                prev_start_date = curr_start.replace(year=curr_start.year - 1)
            except ValueError:
                prev_start_date = curr_start - timedelta(days=365)
            try:
                prev_end_date = curr_end.replace(year=curr_end.year - 1)
            except ValueError:
                prev_end_date = curr_end - timedelta(days=365)
            prev_start_dt = timezone.make_aware(datetime.combine(prev_start_date, time.min))
            prev_end_dt = timezone.make_aware(datetime.combine(prev_end_date, time.max))
        else:
            delta = end_dt - start_dt
            prev_start_dt = start_dt - delta - timedelta(seconds=1)
            prev_end_dt = start_dt - timedelta(seconds=1)

        return prev_start_dt, prev_end_dt

    @classmethod
    def get_dashboard_summary(cls, *, tenant, period: str = "today", start_date_str: str = None, end_date_str: str = None) -> dict:
        start_dt, end_dt = cls.resolve_date_range(period, start_date_str, end_date_str)

        # Sales in scope: not fully voided and not b2b_rejected
        valid_statuses = [
            Sale.STATUS_COMPLETED,
            Sale.STATUS_PARTIALLY_VOIDED,
            Sale.STATUS_B2B_ACCEPTED,
            Sale.STATUS_B2B_PARTIALLY_ACCEPTED,
            Sale.STATUS_B2B_PENDING,
            Sale.STATUS_B2B_RETURN_PENDING,
        ]

        sales = list(
            Sale.objects.filter(
                tenant=tenant,
                status__in=valid_statuses,
                created_at__range=(start_dt, end_dt),
            ).select_related("sold_by").prefetch_related("items__product_variant__product")
        )

        # Debt collections (payments made by debtors in this period)
        debt_payments = list(
            DebtPayment.objects.filter(
                tenant=tenant,
                is_correction=False,
                paid_at__range=(start_dt, end_dt),
            )
        )
        collected_debt_uzs = Decimal("0.00")
        collected_debt_usd = Decimal("0.00")
        for dp in debt_payments:
            if dp.currency == DebtPayment.CURRENCY_UZS:
                collected_debt_uzs += dp.amount
            else:
                collected_debt_usd += dp.amount

        # Real cash / card receipts from sales
        cash_revenue_uzs = Decimal("0.00")
        cash_revenue_usd = Decimal("0.00")
        card_revenue_uzs = Decimal("0.00")
        card_revenue_usd = Decimal("0.00")

        # Debt sales in period (not real receipts yet)
        debt_sales_uzs = Decimal("0.00")
        debt_sales_usd = Decimal("0.00")
        debt_sales_count = 0

        net_profit_uzs = Decimal("0.00")
        net_profit_usd = Decimal("0.00")

        sales_count_uzs = 0
        sales_count_usd = 0

        # Day-by-day chart data (pre-populate all days in range so empty days have 0.00 instead of vanishing)
        daily_data = {}
        curr = start_dt.date()
        while curr <= end_dt.date():
            d_key = curr.strftime("%Y-%m-%d")
            daily_data[d_key] = {
                "date": d_key,
                "revenue_uzs": Decimal("0.00"),     # Real cash/card receipts + debt collections
                "revenue_usd": Decimal("0.00"),
                "debt_sales_uzs": Decimal("0.00"),  # Credit sales given
                "debt_sales_usd": Decimal("0.00"),
                "total_sales_uzs": Decimal("0.00"), # Gross turnover (revenue + debt sales)
                "total_sales_usd": Decimal("0.00"),
                "profit_uzs": Decimal("0.00"),
                "profit_usd": Decimal("0.00"),
                "prev_profit_uzs": Decimal("0.00"),
                "prev_profit_usd": Decimal("0.00"),
                "prev_date": "",
                "sales_count": 0,
                "debt_count": 0,
            }
            curr += timedelta(days=1)

        # Incorporate debt payments into daily real revenue
        for dp in debt_payments:
            dp_key = timezone.localtime(dp.paid_at).strftime("%Y-%m-%d")
            if dp_key not in daily_data:
                daily_data[dp_key] = {
                    "date": dp_key,
                    "revenue_uzs": Decimal("0.00"),
                    "revenue_usd": Decimal("0.00"),
                    "debt_sales_uzs": Decimal("0.00"),
                    "debt_sales_usd": Decimal("0.00"),
                    "total_sales_uzs": Decimal("0.00"),
                    "total_sales_usd": Decimal("0.00"),
                    "profit_uzs": Decimal("0.00"),
                    "profit_usd": Decimal("0.00"),
                    "sales_count": 0,
                    "debt_count": 0,
                }
            if dp.currency == DebtPayment.CURRENCY_UZS:
                daily_data[dp_key]["revenue_uzs"] += dp.amount
            else:
                daily_data[dp_key]["revenue_usd"] += dp.amount

        # Payment methods breakdown
        payment_methods = {
            "cash": {"count": 0, "amount_uzs": Decimal("0.00"), "amount_usd": Decimal("0.00")},
            "card": {"count": 0, "amount_uzs": Decimal("0.00"), "amount_usd": Decimal("0.00")},
            "debt": {"count": 0, "amount_uzs": Decimal("0.00"), "amount_usd": Decimal("0.00")},
            "debt_collection": {
                "count": len(debt_payments),
                "amount_uzs": collected_debt_uzs,
                "amount_usd": collected_debt_usd,
            },
        }

        # Cashiers leaderboard
        cashiers = defaultdict(lambda: {
            "name": "",
            "sales_count": 0,
            "debt_count": 0,
            "total_amount_uzs": Decimal("0.00"),
            "total_amount_usd": Decimal("0.00"),
            "revenue_uzs": Decimal("0.00"),
            "revenue_usd": Decimal("0.00"),
            "debt_amount_uzs": Decimal("0.00"),
            "debt_amount_usd": Decimal("0.00"),
        })

        # Top products tracking
        product_sales = defaultdict(lambda: {
            "name": "",
            "sku": "",
            "quantity_sold": Decimal("0.000"),
            "cash_quantity": Decimal("0.000"),
            "debt_quantity": Decimal("0.000"),
            "revenue": Decimal("0.00"),
            "cash_revenue": Decimal("0.00"),
            "debt_revenue": Decimal("0.00"),
            "profit": Decimal("0.00"),
            "currency": "UZS",
        })

        for sale in sales:
            date_key = timezone.localtime(sale.created_at).strftime("%Y-%m-%d")
            if date_key not in daily_data:
                daily_data[date_key] = {
                    "date": date_key,
                    "revenue_uzs": Decimal("0.00"),
                    "revenue_usd": Decimal("0.00"),
                    "debt_sales_uzs": Decimal("0.00"),
                    "debt_sales_usd": Decimal("0.00"),
                    "total_sales_uzs": Decimal("0.00"),
                    "total_sales_usd": Decimal("0.00"),
                    "profit_uzs": Decimal("0.00"),
                    "profit_usd": Decimal("0.00"),
                    "sales_count": 0,
                    "debt_count": 0,
                }
            daily_data[date_key]["sales_count"] += 1

            if sale.currency == Sale.CURRENCY_UZS:
                sales_count_uzs += 1
            else:
                sales_count_usd += 1

            # Cashier
            name_parts = [sale.sold_by.first_name, sale.sold_by.last_name]
            full_name = " ".join(p for p in name_parts if p).strip()
            seller_name = full_name or sale.sold_by.username or sale.sold_by.phone_number or f"User #{sale.sold_by.id}"
            cashiers[sale.sold_by_id]["name"] = seller_name
            cashiers[sale.sold_by_id]["sales_count"] += 1

            # Payment type
            is_debt = (sale.payment_type == Sale.PAYMENT_DEBT)
            if is_debt:
                debt_sales_count += 1
                daily_data[date_key]["debt_count"] += 1
                cashiers[sale.sold_by_id]["debt_count"] += 1

            if sale.payment_type in payment_methods:
                payment_methods[sale.payment_type]["count"] += 1

            # Process items for net profit and top products
            for item in sale.items.all():
                active_qty = effective_quantity(item)
                if active_qty <= 0:
                    continue

                item_rev = active_qty * item.total_price / item.quantity
                item_cost = active_qty * item.cost_price
                item_net = item.net_amount if item.net_amount is not None else item.total_price
                item_prof = active_qty * item_net / item.quantity - item_cost

                prod_key = item.product_variant_id
                product_sales[prod_key]["name"] = f"{item.product_variant.product.name} ({item.product_variant.name})"
                product_sales[prod_key]["sku"] = item.product_variant.sku
                product_sales[prod_key]["quantity_sold"] += active_qty
                product_sales[prod_key]["revenue"] += item_rev
                product_sales[prod_key]["profit"] += item_prof
                product_sales[prod_key]["currency"] = sale.currency

                if is_debt:
                    product_sales[prod_key]["debt_quantity"] += active_qty
                    product_sales[prod_key]["debt_revenue"] += item_rev
                else:
                    product_sales[prod_key]["cash_quantity"] += active_qty
                    product_sales[prod_key]["cash_revenue"] += item_rev

                if sale.currency == Sale.CURRENCY_UZS:
                    net_profit_uzs += item_prof
                    daily_data[date_key]["total_sales_uzs"] += item_rev
                    daily_data[date_key]["profit_uzs"] += item_prof
                    payment_methods[sale.payment_type]["amount_uzs"] += item_rev
                    cashiers[sale.sold_by_id]["total_amount_uzs"] += item_rev

                    if is_debt:
                        debt_sales_uzs += item_rev
                        daily_data[date_key]["debt_sales_uzs"] += item_rev
                        cashiers[sale.sold_by_id]["debt_amount_uzs"] += item_rev
                    else:
                        if sale.payment_type == Sale.PAYMENT_CASH:
                            cash_revenue_uzs += item_rev
                        elif sale.payment_type == Sale.PAYMENT_CARD:
                            card_revenue_uzs += item_rev
                        daily_data[date_key]["revenue_uzs"] += item_rev
                        cashiers[sale.sold_by_id]["revenue_uzs"] += item_rev
                else:
                    net_profit_usd += item_prof
                    daily_data[date_key]["total_sales_usd"] += item_rev
                    daily_data[date_key]["profit_usd"] += item_prof
                    payment_methods[sale.payment_type]["amount_usd"] += item_rev
                    cashiers[sale.sold_by_id]["total_amount_usd"] += item_rev

                    if is_debt:
                        debt_sales_usd += item_rev
                        daily_data[date_key]["debt_sales_usd"] += item_rev
                        cashiers[sale.sold_by_id]["debt_amount_usd"] += item_rev
                    else:
                        if sale.payment_type == Sale.PAYMENT_CASH:
                            cash_revenue_usd += item_rev
                        elif sale.payment_type == Sale.PAYMENT_CARD:
                            card_revenue_usd += item_rev
                        daily_data[date_key]["revenue_usd"] += item_rev
                        cashiers[sale.sold_by_id]["revenue_usd"] += item_rev

        # Real Revenue received into register/bank: Cash sales + Card sales + Collected debts in period
        total_revenue_uzs = cash_revenue_uzs + card_revenue_uzs + collected_debt_uzs
        total_revenue_usd = cash_revenue_usd + card_revenue_usd + collected_debt_usd

        # Total Sales Volume (Gross Turnover): Real cash/card sales + Debt sales
        total_sales_uzs = cash_revenue_uzs + card_revenue_uzs + debt_sales_uzs
        total_sales_usd = cash_revenue_usd + card_revenue_usd + debt_sales_usd

        # Total Costs / Expenses (Cost of Goods Sold in period)
        total_cost_uzs = max(Decimal("0.00"), total_sales_uzs - net_profit_uzs)
        total_cost_usd = max(Decimal("0.00"), total_sales_usd - net_profit_usd)

        # Debts summary: Current outstanding balance across all counterparties
        debt_qs = Counterparty.objects.filter(tenant=tenant, is_active=True)
        total_debt_uzs = debt_qs.filter(debt_balance_uzs__gt=0).aggregate(s=Sum("debt_balance_uzs"))["s"] or Decimal("0.00")
        total_debt_usd = debt_qs.filter(debt_balance_usd__gt=0).aggregate(s=Sum("debt_balance_usd"))["s"] or Decimal("0.00")
        debtors_count = debt_qs.filter(Q(debt_balance_uzs__gt=0) | Q(debt_balance_usd__gt=0)).count()
        total_customers_count = debt_qs.count()

        # Store Overview: Warehouse Inventory Valuation
        stock_qs = Stock.objects.filter(tenant=tenant, quantity__gt=0)
        retail_price = Case(
            When(product_variant__price_recommended__gt=0, then=F("product_variant__price_recommended")),
            default=F("product_variant__price_min"),
        )
        totals = stock_qs.aggregate(
            total_quantity=Sum("quantity"),
            cost_uzs=Sum(F("quantity") * Coalesce("last_cost_price", Decimal("0")),
                         filter=Q(product_variant__product__category__currency="UZS")),
            cost_usd=Sum(F("quantity") * Coalesce("last_cost_price", Decimal("0")),
                         filter=Q(product_variant__product__category__currency="USD")),
            retail_uzs=Sum(F("quantity") * retail_price, filter=Q(product_variant__product__category__currency="UZS")),
            retail_usd=Sum(F("quantity") * retail_price, filter=Q(product_variant__product__category__currency="USD")),
        )
        inventory_total_qty = totals["total_quantity"] or Decimal("0")
        inventory_cost_value_uzs = totals["cost_uzs"] or Decimal("0")
        inventory_cost_value_usd = totals["cost_usd"] or Decimal("0")
        inventory_retail_value_uzs = totals["retail_uzs"] or Decimal("0")
        inventory_retail_value_usd = totals["retail_usd"] or Decimal("0")
        inventory_variants_count = ProductVariant.objects.filter(tenant=tenant, is_active=True).count()

        # Store Overview: All-time Cumulative Turnover & Net Profit
        all_time_sales_qs = Sale.objects.filter(tenant=tenant, status__in=valid_statuses)
        all_time_sales_count = all_time_sales_qs.count()
        all_time_sales_uzs = SaleItem.objects.filter(sale__tenant=tenant, sale__status__in=valid_statuses, sale__currency=Sale.CURRENCY_UZS).aggregate(s=Sum(effective_quantity_expression() * F("total_price") / F("quantity")))["s"] or Decimal("0.00")
        all_time_sales_usd = SaleItem.objects.filter(sale__tenant=tenant, sale__status__in=valid_statuses, sale__currency=Sale.CURRENCY_USD).aggregate(s=Sum(effective_quantity_expression() * F("total_price") / F("quantity")))["s"] or Decimal("0.00")

        all_time_profit_uzs = SaleItem.objects.filter(
            sale__tenant=tenant,
            sale__status__in=valid_statuses,
            sale__currency=Sale.CURRENCY_UZS
        ).aggregate(
            total=Sum(effective_quantity_expression() * (Coalesce("net_amount", "total_price") / F("quantity") - F("cost_price")))
        )["total"] or Decimal("0.00")

        all_time_profit_usd = SaleItem.objects.filter(
            sale__tenant=tenant,
            sale__status__in=valid_statuses,
            sale__currency=Sale.CURRENCY_USD
        ).aggregate(
            total=Sum(effective_quantity_expression() * (Coalesce("net_amount", "total_price") / F("quantity") - F("cost_price")))
        )["total"] or Decimal("0.00")

        store_overview = {
            "total_debt_uzs": f"{total_debt_uzs:.2f}",
            "total_debt_usd": f"{total_debt_usd:.2f}",
            "debtors_count": debtors_count,
            "total_customers_count": total_customers_count,
            "inventory_cost_value_uzs": f"{inventory_cost_value_uzs:.2f}",
            "inventory_retail_value_uzs": f"{inventory_retail_value_uzs:.2f}",
            "inventory_cost_value_usd": f"{inventory_cost_value_usd:.2f}",
            "inventory_retail_value_usd": f"{inventory_retail_value_usd:.2f}",
            "inventory_total_qty": f"{inventory_total_qty:.0f}" if inventory_total_qty % 1 == 0 else f"{inventory_total_qty:.2f}",
            "inventory_variants_count": inventory_variants_count,
            "all_time_profit_uzs": f"{all_time_profit_uzs:.2f}",
            "all_time_profit_usd": f"{all_time_profit_usd:.2f}",
            "all_time_sales_uzs": f"{all_time_sales_uzs:.2f}",
            "all_time_sales_usd": f"{all_time_sales_usd:.2f}",
            "all_time_sales_count": all_time_sales_count,
        }

        # Top 10 products
        sorted_products = sorted(product_sales.values(), key=lambda p: p["revenue"], reverse=True)[:10]

        # Previous period range and profit aggregation
        prev_start_dt, prev_end_dt = cls.resolve_previous_date_range(period, start_dt, end_dt)
        prev_sales = list(
            Sale.objects.filter(
                tenant=tenant,
                status__in=valid_statuses,
                created_at__range=(prev_start_dt, prev_end_dt),
            ).prefetch_related("items")
        )

        prev_daily_profit_uzs = defaultdict(lambda: Decimal("0.00"))
        prev_daily_profit_usd = defaultdict(lambda: Decimal("0.00"))
        prev_net_profit_uzs = Decimal("0.00")
        prev_net_profit_usd = Decimal("0.00")

        for p_sale in prev_sales:
            s_date_str = timezone.localtime(p_sale.created_at).strftime("%Y-%m-%d")
            for p_item in p_sale.items.all():
                p_qty = effective_quantity(p_item)
                if p_qty <= 0:
                    continue
                p_net = p_item.net_amount if p_item.net_amount is not None else p_item.total_price
                p_prof = p_qty * (p_net / p_item.quantity - p_item.cost_price)
                if p_sale.currency == Sale.CURRENCY_UZS:
                    prev_daily_profit_uzs[s_date_str] += p_prof
                    prev_net_profit_uzs += p_prof
                else:
                    prev_daily_profit_usd[s_date_str] += p_prof
                    prev_net_profit_usd += p_prof

        sorted_curr_dates = sorted(daily_data.keys())
        if period == "today":
            yesterday_str = prev_start_dt.strftime("%Y-%m-%d")
            for d_k in sorted_curr_dates:
                daily_data[d_k]["prev_profit_uzs"] = prev_daily_profit_uzs[yesterday_str]
                daily_data[d_k]["prev_profit_usd"] = prev_daily_profit_usd[yesterday_str]
                daily_data[d_k]["prev_date"] = yesterday_str
        elif period == "this_week":
            for i, d_k in enumerate(sorted_curr_dates):
                matching_prev_date = (prev_start_dt.date() + timedelta(days=i)).strftime("%Y-%m-%d")
                daily_data[d_k]["prev_profit_uzs"] = prev_daily_profit_uzs[matching_prev_date]
                daily_data[d_k]["prev_profit_usd"] = prev_daily_profit_usd[matching_prev_date]
                daily_data[d_k]["prev_date"] = matching_prev_date
        elif period == "this_month":
            first_of_prev = prev_start_dt.date()
            for d_k in sorted_curr_dates:
                curr_dom = datetime.strptime(d_k, "%Y-%m-%d").day
                try:
                    matching_prev_date = first_of_prev.replace(day=curr_dom).strftime("%Y-%m-%d")
                except ValueError:
                    matching_prev_date = ""
                daily_data[d_k]["prev_profit_uzs"] = prev_daily_profit_uzs[matching_prev_date]
                daily_data[d_k]["prev_profit_usd"] = prev_daily_profit_usd[matching_prev_date]
                daily_data[d_k]["prev_date"] = matching_prev_date
        elif period == "this_year":
            for i, d_k in enumerate(sorted_curr_dates):
                matching_prev_date = (prev_start_dt.date() + timedelta(days=i)).strftime("%Y-%m-%d")
                daily_data[d_k]["prev_profit_uzs"] = prev_daily_profit_uzs[matching_prev_date]
                daily_data[d_k]["prev_profit_usd"] = prev_daily_profit_usd[matching_prev_date]
                daily_data[d_k]["prev_date"] = matching_prev_date
        else:
            for i, d_k in enumerate(sorted_curr_dates):
                matching_prev_date = (prev_start_dt.date() + timedelta(days=i)).strftime("%Y-%m-%d")
                daily_data[d_k]["prev_profit_uzs"] = prev_daily_profit_uzs[matching_prev_date]
                daily_data[d_k]["prev_profit_usd"] = prev_daily_profit_usd[matching_prev_date]
                daily_data[d_k]["prev_date"] = matching_prev_date

        # Sorted daily chart
        sorted_chart = [daily_data[k] for k in sorted_curr_dates]

        avg_check_uzs = (total_sales_uzs / sales_count_uzs) if sales_count_uzs > 0 else Decimal("0.00")
        avg_check_usd = (total_sales_usd / sales_count_usd) if sales_count_usd > 0 else Decimal("0.00")

        return {
            "period": period,
            "start_date": start_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "end_date": end_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "kpi": {
                "total_revenue_uzs": f"{total_revenue_uzs:.2f}",
                "total_revenue_usd": f"{total_revenue_usd:.2f}",
                "real_revenue_uzs": f"{total_revenue_uzs:.2f}",
                "real_revenue_usd": f"{total_revenue_usd:.2f}",
                "cash_revenue_uzs": f"{cash_revenue_uzs:.2f}",
                "cash_revenue_usd": f"{cash_revenue_usd:.2f}",
                "card_revenue_uzs": f"{card_revenue_uzs:.2f}",
                "card_revenue_usd": f"{card_revenue_usd:.2f}",
                "total_sales_uzs": f"{total_sales_uzs:.2f}",
                "total_sales_usd": f"{total_sales_usd:.2f}",
                "debt_sales_uzs": f"{debt_sales_uzs:.2f}",
                "debt_sales_usd": f"{debt_sales_usd:.2f}",
                "debt_sales_count": debt_sales_count,
                "collected_debt_uzs": f"{collected_debt_uzs:.2f}",
                "collected_debt_usd": f"{collected_debt_usd:.2f}",
                "collected_debt_count": len(debt_payments),
                "net_profit_uzs": f"{net_profit_uzs:.2f}",
                "net_profit_usd": f"{net_profit_usd:.2f}",
                "total_cost_uzs": f"{total_cost_uzs:.2f}",
                "total_cost_usd": f"{total_cost_usd:.2f}",
                "prev_net_profit_uzs": f"{prev_net_profit_uzs:.2f}",
                "prev_net_profit_usd": f"{prev_net_profit_usd:.2f}",
                "total_debt_uzs": f"{total_debt_uzs:.2f}",
                "total_debt_usd": f"{total_debt_usd:.2f}",
                "sales_count": len(sales),
                "average_check_uzs": f"{avg_check_uzs:.2f}",
                "average_check_usd": f"{avg_check_usd:.2f}",
                # Store-wide lifetime metrics
                "debtors_count": debtors_count,
                "total_customers_count": total_customers_count,
                "inventory_cost_value_uzs": f"{inventory_cost_value_uzs:.2f}",
                "inventory_retail_value_uzs": f"{inventory_retail_value_uzs:.2f}",
            "inventory_cost_value_usd": f"{inventory_cost_value_usd:.2f}",
            "inventory_retail_value_usd": f"{inventory_retail_value_usd:.2f}",
                "inventory_total_qty": f"{inventory_total_qty:.0f}" if inventory_total_qty % 1 == 0 else f"{inventory_total_qty:.2f}",
                "inventory_variants_count": inventory_variants_count,
                "all_time_profit_uzs": f"{all_time_profit_uzs:.2f}",
                "all_time_profit_usd": f"{all_time_profit_usd:.2f}",
                "all_time_sales_uzs": f"{all_time_sales_uzs:.2f}",
                "all_time_sales_usd": f"{all_time_sales_usd:.2f}",
                "all_time_sales_count": all_time_sales_count,
            },
            "store_overview": store_overview,
            # Top-level aliases for direct frontend compatibility
            "total_revenue_uzs": f"{total_revenue_uzs:.2f}",
            "total_revenue_usd": f"{total_revenue_usd:.2f}",
            "real_revenue_uzs": f"{total_revenue_uzs:.2f}",
            "real_revenue_usd": f"{total_revenue_usd:.2f}",
            "cash_revenue_uzs": f"{cash_revenue_uzs:.2f}",
            "cash_revenue_usd": f"{cash_revenue_usd:.2f}",
            "card_revenue_uzs": f"{card_revenue_uzs:.2f}",
            "card_revenue_usd": f"{card_revenue_usd:.2f}",
            "total_sales_uzs": f"{total_sales_uzs:.2f}",
            "total_sales_usd": f"{total_sales_usd:.2f}",
            "debt_sales_uzs": f"{debt_sales_uzs:.2f}",
            "debt_sales_usd": f"{debt_sales_usd:.2f}",
            "debt_sales_count": debt_sales_count,
            "collected_debt_uzs": f"{collected_debt_uzs:.2f}",
            "collected_debt_usd": f"{collected_debt_usd:.2f}",
            "collected_debt_count": len(debt_payments),
            "net_profit_uzs": f"{net_profit_uzs:.2f}",
            "net_profit_usd": f"{net_profit_usd:.2f}",
            "total_cost_uzs": f"{total_cost_uzs:.2f}",
            "total_cost_usd": f"{total_cost_usd:.2f}",
            "prev_net_profit_uzs": f"{prev_net_profit_uzs:.2f}",
            "prev_net_profit_usd": f"{prev_net_profit_usd:.2f}",
            "total_debt_uzs": f"{total_debt_uzs:.2f}",
            "total_debt_usd": f"{total_debt_usd:.2f}",
            "sales_count": len(sales),
            "average_check_uzs": f"{avg_check_uzs:.2f}",
            "average_check_usd": f"{avg_check_usd:.2f}",
            "sales_chart": [
                {
                    "date": d["date"],
                    "revenue_uzs": f"{d['revenue_uzs']:.2f}",
                    "revenue_usd": f"{d['revenue_usd']:.2f}",
                    "debt_sales_uzs": f"{d['debt_sales_uzs']:.2f}",
                    "debt_sales_usd": f"{d['debt_sales_usd']:.2f}",
                    "total_sales_uzs": f"{d['total_sales_uzs']:.2f}",
                    "total_sales_usd": f"{d['total_sales_usd']:.2f}",
                    "profit_uzs": f"{d['profit_uzs']:.2f}",
                    "profit_usd": f"{d['profit_usd']:.2f}",
                    "prev_profit_uzs": f"{d.get('prev_profit_uzs', Decimal('0.00')):.2f}",
                    "prev_profit_usd": f"{d.get('prev_profit_usd', Decimal('0.00')):.2f}",
                    "prev_date": d.get("prev_date", ""),
                    "sales_count": d["sales_count"],
                    "debt_count": d["debt_count"],
                }
                for d in sorted_chart
            ],
            "top_products": [
                {
                    "name": p["name"],
                    "product_name": p["name"],
                    "sku": p["sku"],
                    "quantity_sold": f"{p['quantity_sold']:.3f}",
                    "total_quantity": f"{p['quantity_sold']:.3f}",
                    "cash_quantity": f"{p['cash_quantity']:.3f}",
                    "debt_quantity": f"{p['debt_quantity']:.3f}",
                    "revenue": f"{p['revenue']:.2f}",
                    "total_revenue_uzs": f"{p['revenue']:.2f}",
                    "cash_revenue": f"{p['cash_revenue']:.2f}",
                    "debt_revenue": f"{p['debt_revenue']:.2f}",
                    "profit": f"{p['profit']:.2f}",
                    "currency": p["currency"],
                }
                for p in sorted_products
            ],
            "payment_methods": {
                k: {
                    "count": v["count"],
                    "amount_uzs": f"{v['amount_uzs']:.2f}",
                    "amount_usd": f"{v['amount_usd']:.2f}",
                }
                for k, v in payment_methods.items()
            },
            "payment_methods_list": [
                {
                    "method": k.upper(),
                    "count": v["count"],
                    "total_uzs": f"{v['amount_uzs']:.2f}",
                    "total_usd": f"{v['amount_usd']:.2f}",
                }
                for k, v in payment_methods.items()
            ],
            "cashiers_leaderboard": [
                {
                    "name": v["name"],
                    "cashier_name": v["name"],
                    "sales_count": v["sales_count"],
                    "debt_count": v["debt_count"],
                    "total_sales_count": v["sales_count"],
                    "total_amount_uzs": f"{v['total_amount_uzs']:.2f}",
                    "total_revenue_uzs": f"{v['revenue_uzs']:.2f}",
                    "revenue_uzs": f"{v['revenue_uzs']:.2f}",
                    "revenue_usd": f"{v['revenue_usd']:.2f}",
                    "debt_amount_uzs": f"{v['debt_amount_uzs']:.2f}",
                    "debt_amount_usd": f"{v['debt_amount_usd']:.2f}",
                    "total_amount_usd": f"{v['total_amount_usd']:.2f}",
                }
                for v in sorted(cashiers.values(), key=lambda c: c["sales_count"], reverse=True)
            ],
        }
