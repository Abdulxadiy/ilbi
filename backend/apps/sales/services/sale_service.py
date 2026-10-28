import hashlib
import json
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction

from apps.catalog.models import ProductVariant
from apps.core import event_clock as timezone
from apps.inventory.services import StockService, StockServiceError
from apps.sales.document_identity import document_snapshot
from apps.sales.models import Counterparty, Notification, Sale, SaleItem
from apps.sales.receipt_items import product_snapshot
from apps.sales.services.debt_reminder_service import UNSET, set_debt_due_date
from apps.sales.services.debt_service import DebtService
from apps.sales.taxes import calculate_line
from apps.tenants.models import SellerProfile
from apps.tenants.receipt_settings import receipt_settings


class SaleServiceError(Exception):
    pass


class InsufficientStockError(SaleServiceError, StockServiceError):
    pass


class SaleService:
    @staticmethod
    def _assert_seller_ready(tenant):
        profile = tenant.seller_profile
        if profile is None or profile.owner_id != tenant.owner_id:
            raise SaleServiceError("POS uchun do‘konga tegishli sotuvchi profili kerak.")
        if profile.status != SellerProfile.STATUS_APPROVED:
            raise SaleServiceError("POS faqat tekshiruvdan o‘tgan sotuvchi profiliga ochiladi.")
        if profile.expires_at is None or profile.expires_at <= timezone.now():
            raise SaleServiceError("Sotuvchi profili tekshiruv muddati tugagan. Yangilash uchun ownerga murojaat qiling.")

    @staticmethod
    def _next_receipt_number(tenant) -> str:
        from apps.desktop_sync.protocol import receipt_hint
        if receipt_hint.get():
            return receipt_hint.get()["receipt_number"]
        from apps.tenants.models import Tenant
        # Row-level lock on tenant serializes receipt number generation per tenant
        tenant = Tenant.objects.select_for_update(of=("self",)).select_related("seller_profile").get(pk=tenant.pk)

        today_str = timezone.localtime().strftime('%Y%m%d')
        prefix = f"POS-{today_str}-"
        if getattr(settings, "DESKTOP_MODE", False):
            from apps.desktop_sync.local import get_state
            device = get_state("device")
            prefix = f"O{device['device_id'].replace('-', '')[:6]}-{today_str}-"
        
        last_sale = (
            Sale.objects.filter(tenant=tenant, receipt_number__startswith=prefix)
            .order_by('-id')
            .first()
        )
        if last_sale and last_sale.receipt_number.startswith(prefix):
            try:
                last_seq = int(last_sale.receipt_number.split('-')[-1])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = Sale.objects.filter(tenant=tenant, receipt_number__startswith=prefix).count() + 1
        else:
            next_seq = 1
        return f"{prefix}{next_seq:04d}"

    @classmethod
    @transaction.atomic
    def create_sale(
        cls,
        *,
        tenant,
        user,
        items_data: list,
        payment_type: str = 'cash',
        counterparty: Counterparty = None,
        is_partner_sale: bool = False,
        idempotency_key: str = None,
        expected_tax_settings: dict = None,
        debt_due_date=UNSET,
    ) -> list[Sale]:
        """
        Creates a POS sale in UZS. USD catalog values remain outside retail checkout.
        """
        from apps.tenants.models import Tenant
        # A stable row exists even on a shop's first sale. Acquire it BEFORE the
        # replay lookup so simultaneous requests cannot both miss the same key.
        tenant = Tenant.objects.select_for_update(of=("self",)).select_related("seller_profile").get(pk=tenant.pk)
        canonical = {
            "payment_type": payment_type, "counterparty": getattr(counterparty, "pk", None),
            "partner": is_partner_sale,
            "items": sorted([
                {"variant": int(item['product_variant_id']),
                 "quantity": str(Decimal(str(item['quantity'])).normalize()),
                 "price": str(Decimal(str(item['unit_price'])).normalize()) if item.get('unit_price') is not None else None}
                for item in items_data
            ], key=lambda item: (item['variant'], item['quantity'], str(item['price']))),
        }
        if debt_due_date is not UNSET:
            if payment_type != Sale.PAYMENT_DEBT:
                raise SaleServiceError('Qaytarish sanasi faqat nasiya savdosida belgilanadi.')
            canonical['debt_due_date'] = debt_due_date.isoformat() if debt_due_date else None
        fingerprint = hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()
        idempotency_key = (idempotency_key or "").strip() or None
        if idempotency_key:
            existing_sales = list(Sale.objects.filter(tenant=tenant, idempotency_key=idempotency_key))
            if existing_sales:
                if any(sale.request_fingerprint != fingerprint for sale in existing_sales):
                    raise SaleServiceError("Idempotency kaliti boshqa savat uchun ishlatilgan.")
                return existing_sales

        if expected_tax_settings is not None:
            current = receipt_settings(tenant)
            if not isinstance(expected_tax_settings, dict) or any(
                expected_tax_settings.get(field) != current[field]
                for field in ("is_vat_payer", "vat_rate", "price_includes_vat")
            ):
                raise SaleServiceError("Soliq sozlamalari o‘zgardi. To‘lov oynasini qayta oching.")

        if not items_data:
            raise SaleServiceError("Savatda kamida bitta tovar bo'lishi shart.")

        cls._assert_seller_ready(tenant)

        is_b2b_sale = bool(counterparty and counterparty.target_tenant)
        if is_b2b_sale:
            target_tenant = counterparty.target_tenant
            cls._assert_seller_ready(target_tenant)
            if tenant.seller_profile_id == target_tenant.seller_profile_id:
                raise SaleServiceError("Bir xil sotuvchi profilidagi do‘konlar ichki transferdan foydalanadi, B2B savdodan emas.")

        if len(items_data) > 100:
            raise SaleServiceError("Bitta chekda ko'pi bilan 100 ta tovar bo'lishi mumkin.")
        if len({item["product_variant_id"] for item in items_data}) != len(items_data):
            raise SaleServiceError("Bir variant savatda takrorlanmasligi kerak; miqdorlarini birlashtiring.")

        if not settings.DEBUG:
            raise SaleServiceError(
                "Retail POS production savdosi yopiq: Soliq/OFD tasdig‘i va fiskal provayder integratsiyasi tayyor emas."
            )

        if payment_type == Sale.PAYMENT_DEBT and not counterparty:
            raise SaleServiceError("Qarz (nasiya) savdosi uchun kontragent tanlanishi shart.")
        if counterparty:
            if counterparty.tenant_id != tenant.id or not counterparty.is_active:
                raise SaleServiceError("Kontragent faol va shu do‘konga tegishli bo‘lishi kerak.")
            counterparty = Counterparty.objects.select_for_update().get(pk=counterparty.pk)
            if not counterparty.is_active:
                raise SaleServiceError("Kontragent arxivlangan.")
        from apps.cashbox.services.cashbox_service import CashboxService, CashboxServiceError
        try:
            shift = CashboxService.lock_open_shift(tenant)
        except CashboxServiceError as exc:
            raise SaleServiceError(str(exc)) from exc

        # Load all variants
        variant_ids = [item['product_variant_id'] for item in items_data]
        variants_by_id = {
            v.id: v for v in ProductVariant.objects.select_related('product__category').filter(
                id__in=variant_ids, tenant=tenant, is_active=True
            )
        }

        if len(variants_by_id) != len(set(variant_ids)):
            raise SaleServiceError("Ayrim tovarlar topilmadi yoki nofaol holatda.")

        # Retain the grouping boundary for future provider-specific sale types;
        # the current retail POS gate accepts UZS only.
        items_by_currency = defaultdict(list)
        for item in sorted(items_data, key=lambda entry: entry['product_variant_id']):
            variant = variants_by_id[item['product_variant_id']]
            qty = Decimal(str(item['quantity']))
            if qty <= 0:
                raise SaleServiceError(f"{variant.name} uchun miqdor 0 dan katta bo'lishi shart.")
            if variant.currency != Sale.CURRENCY_UZS:
                raise SaleServiceError("POS savdosi faqat UZS’da rasmiylashtiriladi. USD kurs kalkulyatori savdoga qo‘shilmaydi.")

            # One stock and one catalog price per variant per tenant.
            from apps.inventory.models import Stock
            stock_rec = Stock.objects.select_for_update().filter(tenant=tenant, product_variant=variant).first()

            if is_partner_sale:
                effective_partner = variant.price_partner
                if effective_partner is None or effective_partner <= 0:
                    raise SaleServiceError(
                        f"{variant.product.name} ({variant.name}) uchun 1-narx belgilanmagan. To'ldirish majburiy."
                    )
                unit_price = Decimal(str(item.get('unit_price', effective_partner)))
            else:
                effective_rec = variant.price_recommended
                effective_min = variant.price_min
                unit_price = Decimal(str(item.get('unit_price', effective_rec or effective_min)))

            if unit_price <= 0:
                raise SaleServiceError(f"{variant.name} narxi 0 dan katta bo'lishi shart.")

            items_by_currency[variant.currency].append({
                'variant': variant,
                'quantity': qty,
                'unit_price': unit_price,
                'stock_rec': stock_rec,
            })

        created_sales = []

        # Sort each currency's items by variant id to prevent deadlocks
        for currency, currency_items in items_by_currency.items():
            sorted_items = sorted(currency_items, key=lambda x: x['variant'].id)
            receipt_number = cls._next_receipt_number(tenant)

            is_b2b = bool(counterparty and counterparty.target_tenant)
            status = Sale.STATUS_B2B_PENDING if is_b2b else Sale.STATUS_COMPLETED
            b2b_expires_at = timezone.now() + timedelta(days=7) if is_b2b else None

            sale = Sale.objects.create(
                tenant=tenant,
                shift=shift,
                receipt_number=receipt_number,
                sold_by=user,
                counterparty=counterparty,
                currency=currency,
                is_partner_sale=is_partner_sale,
                total_amount=Decimal('0.00'),
                payment_type=payment_type,
                status=status,
                b2b_target_tenant=counterparty.target_tenant if is_b2b else None,
                b2b_expires_at=b2b_expires_at,
                idempotency_key=idempotency_key,
                request_fingerprint=fingerprint,
                receipt_snapshot=document_snapshot(tenant, user, counterparty),
            )

            total_amount = Decimal('0.00')
            subtotal_amount = Decimal('0.00')
            tax_amount = Decimal('0.00')

            for item in sorted_items:
                variant = item['variant']
                qty = item['quantity']
                price = item['unit_price']
                st_rec = item['stock_rec']
                line_net, line_tax, line_total = calculate_line(
                    quantity=qty, unit_price=price, is_vat_payer=tenant.is_vat_payer,
                    vat_rate=tenant.vat_rate, price_includes_vat=tenant.price_includes_vat,
                )

                # Reduce stock & link to sale
                try:
                    StockService.apply_movement(
                        tenant=tenant,
                        product_variant=variant,
                        type='sotuv',
                        direction='out',
                        quantity=qty,
                        created_by=user,
                        sale=sale,
                        note=f"Sotuv cheki: {receipt_number}",
                    )
                except StockServiceError as err:
                    stock_qty = Decimal('0')
                    try:
                        st = Stock.objects.filter(tenant=tenant, product_variant=variant).first()
                        if st:
                            stock_qty = st.quantity
                    except Exception:
                        pass
                    product_label = variant.product.name
                    if variant.name and variant.name.lower() != 'standart' and variant.name != variant.product.name:
                        product_label = f"{variant.product.name} ({variant.name})"
                    raise InsufficientStockError(
                        f"Omborda yetarli mahsulot qoldig'i yo'q: {product_label}. Omborda mavjud: {stock_qty}, so'ralgan: {qty}. (Not enough stock)"
                    ) from err

                cost_price = (st_rec.last_cost_price if st_rec else None) or (variant.stock.last_cost_price if variant.stock else None) or Decimal('0.00')

                SaleItem.objects.create(
                    tenant=tenant,
                    sale=sale,
                    product_variant=variant,
                    quantity=qty,
                    unit_price=price,
                    product_snapshot=product_snapshot(variant),
                    cost_price=cost_price,
                    original_partner_price=variant.price_partner,
                    total_price=line_total,
                    net_amount=line_net,
                    tax_amount=line_tax,
                    tax_rate=tenant.vat_rate if tenant.is_vat_payer else None,
                    status=SaleItem.STATUS_ACTIVE,
                )

                total_amount += line_total
                subtotal_amount += line_net
                tax_amount += line_tax

            sale.total_amount = total_amount
            sale.subtotal_amount = subtotal_amount
            sale.tax_amount = tax_amount
            sale.save(update_fields=['total_amount', 'subtotal_amount', 'tax_amount'])

            # If debt payment, update counterparty balance
            if payment_type == Sale.PAYMENT_DEBT:
                cp = Counterparty.objects.select_for_update().get(pk=counterparty.pk)
                set_debt_due_date(cp, debt_due_date)
                if currency == 'UZS':
                    cp.debt_balance_uzs += total_amount
                else:
                    cp.debt_balance_usd += total_amount
                cp.save()
                DebtService.check_threshold_and_notify(cp)

            # If B2B, notify recipient tenant owner
            if is_b2b:
                target_owner = counterparty.target_tenant.owner
                Notification.objects.create(
                    tenant=counterparty.target_tenant,
                    recipient=target_owner,
                    type=Notification.TYPE_B2B_REQUEST,
                    title="Yangi B2B tovar o'tkazmasi",
                    message=f"{tenant.name} dan {total_amount:,.2f} {currency} qiymatida tovarlar yuborildi.",
                    link="/b2b",
                )

            created_sales.append(sale)

            if tenant.notify_on_sale:
                from apps.sales.tasks import notify_sale_task
                transaction.on_commit(lambda sale_id=sale.pk: notify_sale_task.delay(sale_id), robust=True)

        return created_sales
