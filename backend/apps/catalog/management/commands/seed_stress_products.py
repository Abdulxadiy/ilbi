"""Management command to bulk-seed thousands of realistic products for database stress/load testing.
No images are created/stored. All other fields (Product, ProductVariant, Stock, StockMovement) are fully populated.
"""

import time
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.catalog.models import Category, Product, ProductVariant
from apps.catalog.services import ProductService
from apps.inventory.models import Stock, StockMovement
from apps.tenants.models import Tenant

CATEGORY_DEFINITIONS = [
    {
        "kod": "30",
        "name": "Ichimliklar va sharbatlar",
        "currency": "UZS",
        "unit": "dona",
        "brands": [
            "Coca-Cola",
            "Pepsi",
            "Fanta",
            "Sprite",
            "Flash Up",
            "Red Bull",
            "Dinay",
            "Dena",
            "Bliss",
            "Hydrolife",
            "Montella",
            "Chortoq",
            "Bonaqua",
            "Fuse Tea",
            "Gorilla",
        ],
        "items": [
            "Gazlangan ichimlik",
            "Mineral suv",
            "Tabiiy sharbat",
            "Sovuq choy",
            "Energetik ichimlik",
            "Limonad",
            "Nektar",
            "Artezian suvi",
        ],
        "specs": ["0.5L", "1L", "1.5L", "2L", "0.33L banka", "250ml", "0.75L shisha", "5L"],
        "price_min_range": (4000, 25000),
    },
    {
        "kod": "31",
        "name": "Oziq-ovqat va baqqollik",
        "currency": "UZS",
        "unit": "kg",
        "brands": [
            "Makfa",
            "Barilla",
            "Rolton",
            "Doshirak",
            "Zolotaya Semechka",
            "Shodlik",
            "Oila Tanlovi",
            "Lazer",
            "Alanga",
            "Devzira",
            "Dunyo",
            "Bonduelle",
            "Qozoq Un",
        ],
        "items": [
            "Guruch",
            "Makaron",
            "Kungaboqar yog'i",
            "O'simlik yog'i",
            "Un oliy nav",
            "Shakar",
            "Osh tuzi",
            "Konservalangan no'xat",
            "Konservalangan makkajo'xori",
            "Grechka",
            "Suli yormasi",
            "Loviya",
        ],
        "specs": ["1kg", "2kg", "5kg", "900g", "800g", "450g", "1L", "5L"],
        "price_min_range": (6000, 85000),
    },
    {
        "kod": "32",
        "name": "Choy, qahva va nonushta",
        "currency": "UZS",
        "unit": "dona",
        "brands": [
            "Ahmad Tea",
            "Greenfield",
            "Tess",
            "Beta Tea",
            "Akbar",
            "Nescafe",
            "Jacobs",
            "MacCoffee",
            "Carte Noire",
            "Lavazza",
            "Nesquik",
        ],
        "items": [
            "Qora choy",
            "Ko'k choy",
            "Eriydigan qahva",
            "Donador qahva",
            "3-in-1 qahva paketi",
            "Kakao kukuni",
            "Meva choyi",
            "Nonushta yormasi",
        ],
        "specs": ["100g", "200g", "250g", "500g", "25 paket", "100 paket", "20 dona", "95g shisha"],
        "price_min_range": (12000, 140000),
    },
    {
        "kod": "33",
        "name": "Sut va sut mahsulotlari",
        "currency": "UZS",
        "unit": "dona",
        "brands": ["Musaffo", "Kamilka", "Sutim", "President", "Danone", "Rastishka", "Savushkin", "Bio-Sut", "Lactel"],
        "items": [
            "Sut 2.5%",
            "Sut 3.2%",
            "Qatiq",
            "Qaymoq",
            "Tvorog",
            "Sariyog' 82.5%",
            "Golland pishlog'i",
            "Mozzarella pishloq",
            "Eritilgan pishloq",
            "Yogurt",
        ],
        "specs": ["1L", "900ml", "500g", "400g", "200g", "180g", "150g", "250g"],
        "price_min_range": (8000, 65000),
    },
    {
        "kod": "34",
        "name": "Shirinliklar va pishiriqlar",
        "currency": "UZS",
        "unit": "dona",
        "brands": [
            "Alpen Gold",
            "Milka",
            "Snickers",
            "Twix",
            "KitKat",
            "Baunti",
            "Roshen",
            "Oreo",
            "Tuk",
            "Yubileynoye",
            "Choco Pie",
            "Kinder",
            "Raffaello",
        ],
        "items": [
            "Sutli shokolad",
            "Qora shokolad",
            "Karamel konfet",
            "Pechenye",
            "Vafli",
            "Shokolad batonchik",
            "Biskvit rulet",
            "Marmelad",
            "Zefir",
        ],
        "specs": ["85g", "90g", "100g", "50g", "150g", "200g", "250g", "500g quti"],
        "price_min_range": (5000, 75000),
    },
    {
        "kod": "35",
        "name": "Maishiy kimyo va tozalash",
        "currency": "UZS",
        "unit": "dona",
        "brands": [
            "Ariel",
            "Tide",
            "Persil",
            "Fairy",
            "Pril",
            "Domestos",
            "Cif",
            "Mr. Proper",
            "Lenor",
            "Bref",
            "Vanish",
            "Sorti",
        ],
        "items": [
            "Kir yuvish kukuni avtomat",
            "Kir yuvish geli",
            "Idish yuvish suyuqligi",
            "Xlorli tozalash geli",
            "Universal pol yuvish vositasi",
            "Mato yumshatuvchi",
            "Dog' ketkazuvchi",
        ],
        "specs": ["450ml", "900ml", "1L", "1.5kg", "3kg", "4.5kg", "500ml"],
        "price_min_range": (14000, 160000),
    },
    {
        "kod": "36",
        "name": "Shaxsiy gigiyena",
        "currency": "UZS",
        "unit": "dona",
        "brands": [
            "Head & Shoulders",
            "Clear",
            "Pantene",
            "Colgate",
            "Blend-a-med",
            "Splat",
            "Safeguard",
            "Duru",
            "Dove",
            "Nivea",
            "Gillette",
            "Palmolive",
        ],
        "items": [
            "Shampun",
            "Soch balzami",
            "Tish pastasi",
            "Tish cho'tkasi",
            "Antibakterial qo'l sovuni",
            "Dush geli",
            "Dezodorant sprey",
            "Soqol olish ko'pigi",
        ],
        "specs": ["200ml", "400ml", "100ml", "75ml", "150ml", "90g", "1 dona"],
        "price_min_range": (10000, 85000),
    },
    {
        "kod": "37",
        "name": "Elektronika va aksessuarlar",
        "currency": "UZS",
        "unit": "dona",
        "brands": [
            "Hoco",
            "Borofone",
            "Remax",
            "Baseus",
            "Xiaomi",
            "Joyroom",
            "Duracell",
            "Energizer",
            "Ugreen",
            "Anker",
        ],
        "items": [
            "Smartfon zaryadka kabeli",
            "Tarmoq adapteri Fast Charge",
            "Powerbank tashqi akkumulyator",
            "Bluetooth simsiz quloqchin",
            "Avtomobil telefon ushlagichi",
            "Ishqoriy batareyka",
        ],
        "specs": [
            "Type-C 1m",
            "Lightning 1m",
            "20W",
            "33W",
            "10000mAh",
            "20000mAh",
            "AA 2 dona",
            "AAA 4 dona",
            "TWS Wireless",
        ],
        "price_min_range": (20000, 350000),
    },
    {
        "kod": "01",
        "name": "Chexollar",
        "currency": "UZS",
        "unit": "dona",
        "brands": ["Silicone Case", "Leather Case", "Clear TPU", "Armor Case", "Magnetic MagSafe", "Carbon Fiber"],
        "items": [
            "G'ilof iPhone 13",
            "G'ilof iPhone 14 Pro",
            "G'ilof iPhone 15",
            "G'ilof Samsung A54",
            "G'ilof Samsung S23",
            "G'ilof Redmi Note 12",
            "G'ilof Redmi Note 13",
        ],
        "specs": ["Qora", "Shaffof", "To'q ko'k", "Yashil", "Pushti", "Binafsharang", "Kulrang"],
        "price_min_range": (25000, 120000),
    },
    {
        "kod": "11",
        "name": "Steklo",
        "currency": "UZS",
        "unit": "dona",
        "brands": ["9D Ceramic", "11D Full Glue", "Privacy Anti-Spy", "Gorilla Shield", "Super D", "Diamond Pro"],
        "items": [
            "Himoya oynasi iPhone 11/XR",
            "Himoya oynasi iPhone 12/12 Pro",
            "Himoya oynasi iPhone 13/14",
            "Himoya oynasi iPhone 15 Pro",
            "Himoya oynasi Samsung A14",
            "Himoya oynasi Samsung A24",
            "Himoya oynasi Redmi 12",
        ],
        "specs": ["Shaffof 9D", "Anti-shpiyon (qora)", "Matoviy (xira)", "To'liq qoplovchi"],
        "price_min_range": (15000, 70000),
    },
    {
        "kod": "15",
        "name": "Kabellar",
        "currency": "UZS",
        "unit": "metr",
        "brands": ["Ugreen", "Vention", "Baseus", "Prolink", "D-Link", "CommScope"],
        "items": [
            "HDMI 2.1 yuqori tezlikdagi kabel",
            "Ethernet LAN RJ45 Cat6 kabel",
            "AUX 3.5mm audio kabel",
            "Type-C to Type-C 100W PD kabel",
            "Optik audio kabel Toslink",
        ],
        "specs": ["1 metr", "2 metr", "3 metr", "5 metr", "10 metr"],
        "price_min_range": (18000, 150000),
    },
    {
        "kod": "06",
        "name": "Televizor",
        "currency": "UZS",
        "unit": "dona",
        "brands": ["Artel", "Shivaki", "Samsung", "LG", "TCL", "Hisense", "Xiaomi"],
        "items": ["Smart TV Android", "Smart TV Google TV", "4K Ultra HD Televizor", "Full HD Televizor"],
        "specs": ["32 Dyuym", "43 Dyuym", "50 Dyuym", "55 Dyuym", "65 Dyuym"],
        "price_min_range": (1400000, 6500000),
    },
]


def calculate_ean13_checksum(prefix12: str) -> str:
    """Standard EAN-13 check digit calculation."""
    odd_sum = sum(int(prefix12[i]) for i in range(0, 12, 2))
    even_sum = sum(int(prefix12[i]) for i in range(1, 12, 2))
    total = odd_sum + (even_sum * 3)
    check_digit = (10 - (total % 10)) % 10
    return str(check_digit)


def round_price(val, step: int = 500) -> Decimal:
    """Rounds price to clean monetary steps (e.g. 500 or 1000 sum)."""
    val_int = int(Decimal(str(val)))
    rounded = (val_int // step) * step
    return Decimal(str(max(rounded, step)))


class Command(BaseCommand):
    help = "Bulk seed 5000 realistic products with variants and stock (no images) for database stress testing."

    def add_arguments(self, parser):
        parser.add_argument(
            "--count",
            type=int,
            default=5000,
            help="Total number of products to generate (default: 5000)",
        )
        parser.add_argument(
            "--tenant-id",
            type=int,
            required=False,
            help="Tenant ID to seed products into",
        )
        parser.add_argument(
            "--public-code",
            type=str,
            required=False,
            help="Tenant public code, e.g. 0D2008E8",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=1000,
            help="Batch size for bulk_create operations (default: 1000)",
        )
        parser.add_argument(
            "--i-know-this-is-not-production",
            action="store_true",
            help="Bypass production guard when running with DEBUG=False",
        )

    def handle(self, *args, **options):
        if not settings.DEBUG and not options.get("i_know_this_is_not_production"):
            raise CommandError(
                "Refusing to run stress seeder when settings.DEBUG is False unless "
                "--i-know-this-is-not-production is passed."
            )

        total_target = options["count"]
        tenant_id = options.get("tenant_id")
        public_code = options.get("public_code")
        batch_size = options["batch_size"]

        if not tenant_id and not public_code:
            raise CommandError("Either --tenant-id or --public-code must be provided.")

        start_time = time.time()

        try:
            if public_code:
                tenant = Tenant.objects.get(public_code__iexact=public_code.strip())
            else:
                tenant = Tenant.objects.get(id=tenant_id)
        except Tenant.DoesNotExist as err:
            identifier = public_code if public_code else tenant_id
            raise CommandError(f"Tenant with identifier '{identifier}' not found.") from err

        owner = tenant.owner
        if not owner:
            raise CommandError(f"Tenant '{tenant.name}' has no owner.")

        self.stdout.write(
            self.style.NOTICE(
                f"\n======================================================\n"
                f"STRESS TEST PRODUCT SEEDER\n"
                f"Tenant: '{tenant.name}' (ID: {tenant.id})\n"
                f"Target products: {total_target}\n"
                f"Batch size: {batch_size}\n"
                f"Tenant stock: '{tenant.name}'\n"
                f"Created by: {owner.phone_number if owner else 'None'}\n"
                f"Images: SKIPPED (user request: rasmlar kerak emas)\n"
                f"======================================================\n"
            )
        )

        # 1. Ensure categories exist and load them
        categories_by_kod = {}
        for cat_def in CATEGORY_DEFINITIONS:
            category, _ = Category.objects.get_or_create(
                tenant=tenant,
                kod=cat_def["kod"],
                defaults={
                    "name": cat_def["name"],
                    "currency": cat_def["currency"],
                },
            )
            categories_by_kod[cat_def["kod"]] = category

        all_categories = list(Category.objects.filter(tenant=tenant))
        self.stdout.write(self.style.SUCCESS(f"Categories ready: {len(all_categories)} categories available."))

        # 2. Determine initial SKU sequence offset
        existing_skus = ProductVariant.objects.filter(tenant=tenant).values_list("sku", flat=True)
        max_sku_num = 0
        for s in existing_skus:
            if s and s.isdigit():
                max_sku_num = max(max_sku_num, int(s))

        self.stdout.write(f"Current highest SKU for tenant: {max_sku_num:06d}. Next starts at {max_sku_num + 1:06d}.")

        # 3. Determine initial Barcode sequence offset
        existing_barcodes = set(
            ProductVariant.objects.filter(tenant=tenant).exclude(barcode__isnull=True).values_list("barcode", flat=True)
        )
        barcode_seq = 200000001

        # 4. Generate and insert in batches
        current_sku_num = max_sku_num
        seeded_total = 0
        cat_count = len(CATEGORY_DEFINITIONS)
        batches_count = (total_target + batch_size - 1) // batch_size

        for batch_idx in range(batches_count):
            batch_start_idx = batch_idx * batch_size
            batch_end_idx = min(batch_start_idx + batch_size, total_target)
            current_batch_len = batch_end_idx - batch_start_idx

            products_to_create = []
            variants_meta = []

            for i in range(batch_start_idx, batch_end_idx):
                item_idx = i + 1
                cat_def = CATEGORY_DEFINITIONS[i % cat_count]
                category = categories_by_kod[cat_def["kod"]]

                # Generate varied realistic name
                brand = cat_def["brands"][(i // cat_count) % len(cat_def["brands"])]
                item = cat_def["items"][(i // (cat_count * len(cat_def["brands"]))) % len(cat_def["items"])]
                spec = cat_def["specs"][
                    (i // (cat_count * len(cat_def["brands"]) * len(cat_def["items"]))) % len(cat_def["specs"])
                ]

                prod_name = f"{brand} {item} {spec} (Model #{item_idx:05d})"

                # Pricing
                p_min_low, p_min_high = cat_def["price_min_range"]
                step_val = (p_min_high - p_min_low) // 100
                base_price = Decimal(str(p_min_low + ((item_idx * 37) % 100) * step_val))

                cost_price = round_price(base_price * Decimal("0.85"))
                price_partner = round_price(base_price)
                price_min = round_price(base_price * Decimal("1.10"))
                price_recommended = round_price(base_price * Decimal("1.25"))

                # SKU
                current_sku_num += 1
                sku = f"{current_sku_num:06d}"

                # Code
                code = ProductService._build_code(category, price_min)

                # Barcode
                while True:
                    p12 = f"478{barcode_seq:09d}"
                    chk = calculate_ean13_checksum(p12)
                    candidate_barcode = f"{p12}{chk}"
                    barcode_seq += 1
                    if candidate_barcode not in existing_barcodes:
                        existing_barcodes.add(candidate_barcode)
                        break

                unit = cat_def["unit"]

                # Stock quantity (between 15 and 350)
                quantity = Decimal(str(15 + (item_idx * 17) % 335))

                # Product instance
                prod = Product(
                    tenant=tenant,
                    name=prod_name,
                    category=category,
                    image=None,  # No images as explicitly requested
                    is_active=True,
                )
                products_to_create.append(prod)

                variants_meta.append(
                    {
                        "sku": sku,
                        "code": code,
                        "barcode": candidate_barcode,
                        "unit": unit,
                        "price_partner": price_partner,
                        "price_min": price_min,
                        "price_recommended": price_recommended,
                        "cost_price": cost_price,
                        "quantity": quantity,
                    }
                )

            # Bulk insert into DB within an atomic transaction
            with transaction.atomic():
                # 1. Insert Products (PostgreSQL returns PKs)
                created_products = Product.objects.bulk_create(products_to_create)

                # 2. Prepare ProductVariants
                variants_to_create = []
                for p, v_meta in zip(created_products, variants_meta, strict=False):
                    variants_to_create.append(
                        ProductVariant(
                            tenant=tenant,
                            product=p,
                            name="Standart",
                            sku=v_meta["sku"],
                            code=v_meta["code"],
                            barcode=v_meta["barcode"],
                            unit=v_meta["unit"],
                            price_partner=v_meta["price_partner"],
                            price_min=v_meta["price_min"],
                            price_recommended=v_meta["price_recommended"],
                            image=None,
                            is_active=True,
                        )
                    )

                created_variants = ProductVariant.objects.bulk_create(variants_to_create)

                # 3. Prepare Stocks & StockMovements
                stocks_to_create = []
                movements_to_create = []
                for v, v_meta in zip(created_variants, variants_meta, strict=False):
                    stocks_to_create.append(
                        Stock(
                            tenant=tenant,
                            product_variant=v,
                            quantity=v_meta["quantity"],
                            last_cost_price=v_meta["cost_price"],
                        )
                    )
                    movements_to_create.append(
                        StockMovement(
                            tenant=tenant,
                            product_variant=v,
                            type=StockMovement.TYPE_KIRIM,
                            direction=StockMovement.DIRECTION_IN,
                            quantity=v_meta["quantity"],
                            cost_price=v_meta["cost_price"],
                            note="Boshlang'ich qoldiq (Stress test / 5000 mahsulot)",
                            created_by=owner,
                        )
                    )

                Stock.objects.bulk_create(stocks_to_create)
                StockMovement.objects.bulk_create(movements_to_create)

            seeded_total += current_batch_len
            elapsed = time.time() - start_time
            rate = seeded_total / elapsed if elapsed > 0 else 0
            self.stdout.write(
                f"Batch {batch_idx + 1}/{batches_count} saqlandi: "
                f"+{current_batch_len} mahsulot (Jami: {seeded_total}/{total_target}) "
                f"[{elapsed:.1f}s, {rate:.0f} ta/s]"
            )

        total_elapsed = time.time() - start_time
        self.stdout.write(
            self.style.SUCCESS(
                f"\nSUCCESSFULLY COMPLETED STRESS TEST SEEDING!\n"
                f"--------------------------------------------------\n"
                f"- Yaratilgan mahsulotlar (Product): {seeded_total}\n"
                f"- Yaratilgan variantlar (ProductVariant): {seeded_total}\n"
                f"- Yaratilgan ombor qoldiqlari (Stock): {seeded_total}\n"
                f"- Yaratilgan kirim harakatlari (StockMovement): {seeded_total}\n"
                f"- Jami yangi bazadagi yozuvlar: {seeded_total * 4}\n"
                f"- Ketgan vaqt: {total_elapsed:.2f} soniya\n"
                f"- O'rtacha tezlik: {seeded_total / total_elapsed:.1f} ta mahsulot/soniya\n"
                f"- Tenant ombori: '{tenant.name}' (ID: {tenant.id})\n"
                f"- Rasmlar: Mavjud emas (null/blank)\n"
                f"--------------------------------------------------\n"
            )
        )
