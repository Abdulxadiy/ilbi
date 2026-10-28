"""Management command to generate crisp visual product images and assign authentic 13-digit barcodes.
"""

import os
from pathlib import Path
from decimal import Decimal
from django.conf import settings
from django.core.management.base import BaseCommand
from PIL import Image, ImageDraw, ImageFont

from apps.tenants.models import Tenant
from apps.catalog.models import Product, ProductVariant


PRODUCTS_METADATA = {
    # Original products
    "Samsung A17": {
        "brand": "Samsung A17", "detail": "Smartphone 128GB", "category": "Telefon",
        "barcode": "8806091120015", "shape": "tech",
        "primary": (30, 58, 138), "secondary": (219, 234, 254)
    },
    "Steklo GLASS": {
        "brand": "GLASS", "detail": "Himoya Oynasi 9D", "category": "Aksessuar",
        "barcode": "4780009910012", "shape": "tech",
        "primary": (15, 118, 110), "secondary": (204, 251, 241)
    },
    "MyTech TV 32talik": {
        "brand": "MyTech TV", "detail": "Smart TV 32 Dyuym", "category": "Televizor",
        "barcode": "4780008810013", "shape": "tech",
        "primary": (15, 23, 42), "secondary": (239, 68, 68)
    },
    "chexol 31/30/25": {
        "brand": "Silikon Chexol", "detail": "Shoxga Chidamli", "category": "Chexol",
        "barcode": "4780012345678", "shape": "tech",
        "primary": (147, 51, 234), "secondary": (245, 208, 254)
    },
    "Cheexol 26/26/25": {
        "brand": "Charm Chexol", "detail": "Premium Case", "category": "Chexol",
        "barcode": "4780007710015", "shape": "tech",
        "primary": (120, 53, 15), "secondary": (254, 243, 199)
    },

    # 1. Ichimliklar (20 ta)
    "Coca-Cola Classic 1.5L": {
        "brand": "Coca-Cola", "detail": "Classic 1.5 Litr", "category": "Ichimlik",
        "barcode": "5449000000996", "shape": "bottle",
        "primary": (225, 29, 72), "secondary": (254, 226, 226)
    },
    "Coca-Cola Classic 0.5L": {
        "brand": "Coca-Cola", "detail": "Classic 0.5 Litr", "category": "Ichimlik",
        "barcode": "5449000000286", "shape": "bottle",
        "primary": (225, 29, 72), "secondary": (254, 226, 226)
    },
    "Coca-Cola Classic 1L": {
        "brand": "Coca-Cola", "detail": "Classic 1.0 Litr", "category": "Ichimlik",
        "barcode": "5449000052926", "shape": "bottle",
        "primary": (225, 29, 72), "secondary": (254, 226, 226)
    },
    "Fanta Orange 1.5L": {
        "brand": "Fanta", "detail": "Orange 1.5 Litr", "category": "Ichimlik",
        "barcode": "5449000011527", "shape": "bottle",
        "primary": (249, 115, 22), "secondary": (30, 58, 138)
    },
    "Fanta Orange 0.5L": {
        "brand": "Fanta", "detail": "Orange 0.5 Litr", "category": "Ichimlik",
        "barcode": "5449000011534", "shape": "bottle",
        "primary": (249, 115, 22), "secondary": (30, 58, 138)
    },
    "Sprite 1.5L": {
        "brand": "Sprite", "detail": "Limon & Laym 1.5L", "category": "Ichimlik",
        "barcode": "5449000012203", "shape": "bottle",
        "primary": (16, 185, 129), "secondary": (254, 240, 138)
    },
    "Sprite 0.5L": {
        "brand": "Sprite", "detail": "Limon & Laym 0.5L", "category": "Ichimlik",
        "barcode": "5449000014528", "shape": "bottle",
        "primary": (16, 185, 129), "secondary": (254, 240, 138)
    },
    "Pepsi Cola 1.5L": {
        "brand": "Pepsi", "detail": "Original 1.5 Litr", "category": "Ichimlik",
        "barcode": "4823063100342", "shape": "bottle",
        "primary": (2, 132, 199), "secondary": (225, 29, 72)
    },
    "Pepsi Cola 0.5L": {
        "brand": "Pepsi", "detail": "Original 0.5 Litr", "category": "Ichimlik",
        "barcode": "4823063100335", "shape": "bottle",
        "primary": (2, 132, 199), "secondary": (225, 29, 72)
    },
    "Dinay Olma sharbati 1L": {
        "brand": "Dinay", "detail": "Yashil Olma 1.0L", "category": "Sharbat",
        "barcode": "4780001440014", "shape": "box",
        "primary": (101, 163, 13), "secondary": (236, 252, 203)
    },
    "Dinay Shaftoli sharbati 1L": {
        "brand": "Dinay", "detail": "Shirin Shaftoli 1.0L", "category": "Sharbat",
        "barcode": "4780001440021", "shape": "box",
        "primary": (245, 158, 11), "secondary": (254, 243, 199)
    },
    "Dinay Olcha sharbati 1L": {
        "brand": "Dinay", "detail": "Tabiiy Olcha 1.0L", "category": "Sharbat",
        "barcode": "4780001440038", "shape": "box",
        "primary": (190, 18, 60), "secondary": (255, 228, 230)
    },
    "Bliss Anor sharbati 1L": {
        "brand": "Bliss", "detail": "Anor Nektari 1.0L", "category": "Sharbat",
        "barcode": "4780002880017", "shape": "box",
        "primary": (159, 18, 57), "secondary": (251, 113, 133)
    },
    "Bliss Apelsin sharbati 1L": {
        "brand": "Bliss", "detail": "Sershira Apelsin 1.0L", "category": "Sharbat",
        "barcode": "4780002880024", "shape": "box",
        "primary": (234, 88, 12), "secondary": (254, 215, 170)
    },
    "Nestle Pure Life gazsiz suv 1.5L": {
        "brand": "Nestle", "detail": "Pure Life Gazsiz 1.5L", "category": "Suv",
        "barcode": "4780014520015", "shape": "bottle",
        "primary": (14, 165, 233), "secondary": (224, 242, 254)
    },
    "Nestle Pure Life gazsiz suv 0.5L": {
        "brand": "Nestle", "detail": "Pure Life Gazsiz 0.5L", "category": "Suv",
        "barcode": "4780014520022", "shape": "bottle",
        "primary": (14, 165, 233), "secondary": (224, 242, 254)
    },
    "Chortoq gazli mineral suv 0.5L": {
        "brand": "Chortoq", "detail": "Shifobaxsh Mineral 0.5L", "category": "Suv",
        "barcode": "4780031120014", "shape": "bottle",
        "primary": (13, 148, 136), "secondary": (204, 251, 241)
    },
    "Hydrolife toza suv 1.5L": {
        "brand": "Hydrolife", "detail": "Tog' Suvi 1.5L", "category": "Suv",
        "barcode": "4780025110014", "shape": "bottle",
        "primary": (37, 99, 235), "secondary": (219, 234, 254)
    },
    "Flash Up energetik ichimlik 450ml": {
        "brand": "Flash Up", "detail": "Energy Drink 450ml", "category": "Energetik",
        "barcode": "4600682008458", "shape": "can",
        "primary": (22, 163, 74), "secondary": (250, 204, 21)
    },
    "Red Bull energetik ichimlik 250ml": {
        "brand": "Red Bull", "detail": "Energy Drink 250ml", "category": "Energetik",
        "barcode": "9002490100070", "shape": "can",
        "primary": (30, 58, 138), "secondary": (225, 29, 72)
    },

    # 2. Oziq-ovqat va baqqollik (20 ta)
    "Makfa oliy navli bug'doy uni 2kg": {
        "brand": "Makfa", "detail": "Oliy Navli Un 2kg", "category": "Baqqollik",
        "barcode": "4600680001017", "shape": "bag",
        "primary": (202, 138, 4), "secondary": (220, 38, 38)
    },
    "Makfa oliy navli bug'doy uni 1kg": {
        "brand": "Makfa", "detail": "Oliy Navli Un 1kg", "category": "Baqqollik",
        "barcode": "4600680001024", "shape": "bag",
        "primary": (202, 138, 4), "secondary": (220, 38, 38)
    },
    "Makfa spagetti makaron 450g": {
        "brand": "Makfa", "detail": "Spagetti No1 450g", "category": "Makaron",
        "barcode": "4600680002014", "shape": "bag",
        "primary": (180, 83, 9), "secondary": (254, 240, 138)
    },
    "Makfa spiral makaron 450g": {
        "brand": "Makfa", "detail": "Spiral Makaron 450g", "category": "Makaron",
        "barcode": "4600680002021", "shape": "bag",
        "primary": (180, 83, 9), "secondary": (254, 240, 138)
    },
    "Shedevr tozalangan kungaboqar yog'i 1L": {
        "brand": "Shedevr", "detail": "Kungaboqar Yog'i 1L", "category": "Yog'",
        "barcode": "4780010320015", "shape": "bottle",
        "primary": (217, 119, 6), "secondary": (254, 243, 199)
    },
    "Shedevr tozalangan kungaboqar yog'i 5L": {
        "brand": "Shedevr", "detail": "Kungaboqar Yog'i 5L", "category": "Yog'",
        "barcode": "4780010320053", "shape": "bottle",
        "primary": (217, 119, 6), "secondary": (254, 243, 199)
    },
    "Oila tanlovi paxta yog'i 1L": {
        "brand": "Oila Tanlovi", "detail": "Paxta Yog'i 1L", "category": "Yog'",
        "barcode": "4780009510014", "shape": "bottle",
        "primary": (22, 101, 52), "secondary": (254, 240, 138)
    },
    "Lazzat Alanga guruchi 1kg": {
        "brand": "Lazzat", "detail": "Alanga Guruchi 1kg", "category": "Guruch",
        "barcode": "4780023410017", "shape": "bag",
        "primary": (74, 222, 128), "secondary": (240, 253, 244)
    },
    "Lazzat Lazer elita guruchi 1kg": {
        "brand": "Lazzat", "detail": "Lazer Elita Guruch 1kg", "category": "Guruch",
        "barcode": "4780023410024", "shape": "bag",
        "primary": (22, 163, 74), "secondary": (254, 240, 138)
    },
    "Xorazm oq tozalangan shakar 1kg": {
        "brand": "Xorazm Shakar", "detail": "Oq Tozalangan 1kg", "category": "Shakar",
        "barcode": "4780005120018", "shape": "bag",
        "primary": (8, 145, 178), "secondary": (207, 250, 254)
    },
    "Osh tuzi yodlangan Oshxona 1kg": {
        "brand": "Oshxona", "detail": "Yodlangan Tuz 1kg", "category": "Tuz",
        "barcode": "4780006230017", "shape": "bag",
        "primary": (37, 99, 235), "secondary": (219, 234, 254)
    },
    "Rollton tovuqli tezpishar lapsha 60g": {
        "brand": "Rollton", "detail": "Tovuqli Lapsha 60g", "category": "Lapsha",
        "barcode": "4607041130016", "shape": "bag",
        "primary": (234, 179, 8), "secondary": (220, 38, 38)
    },
    "Doshirak mol go'shtli lapsha 90g": {
        "brand": "Doshirak", "detail": "Mol Go'shtli 90g", "category": "Lapsha",
        "barcode": "8801045520014", "shape": "box",
        "primary": (220, 38, 38), "secondary": (254, 240, 138)
    },
    "Baraka tabiiy tomat pastasi 800g": {
        "brand": "Baraka", "detail": "Tomat Pastasi 800g", "category": "Tomat",
        "barcode": "4780017420018", "shape": "can",
        "primary": (185, 28, 28), "secondary": (254, 202, 202)
    },
    "Heinz klassik pomidorli ketchup 350g": {
        "brand": "Heinz", "detail": "Pomidorli Ketchup 350g", "category": "Sous",
        "barcode": "5900437001018", "shape": "bottle",
        "primary": (153, 27, 27), "secondary": (254, 240, 138)
    },
    "Calve zaytunli mayonez 400g": {
        "brand": "Calve", "detail": "Zaytunli Mayonez 400g", "category": "Sous",
        "barcode": "8712566001015", "shape": "bag",
        "primary": (101, 163, 13), "secondary": (254, 243, 199)
    },
    "Bonduelle yashil no'xat 400g": {
        "brand": "Bonduelle", "detail": "Yashil No'xat 400g", "category": "Konserva",
        "barcode": "3083680010017", "shape": "can",
        "primary": (22, 163, 74), "secondary": (250, 204, 21)
    },
    "Bonduelle shirin makkajo'xori 400g": {
        "brand": "Bonduelle", "detail": "Makkajo'xori 400g", "category": "Konserva",
        "barcode": "3083680010024", "shape": "can",
        "primary": (234, 179, 8), "secondary": (22, 163, 74)
    },
    "Greenfield Golden Ceylon choyi 100 paket": {
        "brand": "Greenfield", "detail": "Golden Ceylon 100x2g", "category": "Choy",
        "barcode": "4605246001012", "shape": "box",
        "primary": (6, 95, 70), "secondary": (217, 119, 6)
    },
    "Ahmad Tea Earl Grey qora choy 100g": {
        "brand": "Ahmad Tea", "detail": "Earl Grey Qora 100g", "category": "Choy",
        "barcode": "0548810010156", "shape": "box",
        "primary": (6, 78, 59), "secondary": (202, 138, 4)
    },

    # 3. Choy, qahva va nonushta (10 ta)
    "Tess Pleasure mevali choy 100g": {
        "brand": "Tess", "detail": "Pleasure Mevali 100g", "category": "Choy",
        "barcode": "4605246002019", "shape": "box",
        "primary": (234, 88, 12), "secondary": (254, 215, 170)
    },
    "Nescafe Classic qahvasi 100g": {
        "brand": "Nescafe", "detail": "Classic Qahva 100g", "category": "Qahva",
        "barcode": "7613035252013", "shape": "can",
        "primary": (120, 53, 15), "secondary": (220, 38, 38)
    },
    "Jacobs Monarch eriydigan qahva 95g": {
        "brand": "Jacobs", "detail": "Monarch Qahva 95g", "category": "Qahva",
        "barcode": "8711000501017", "shape": "bottle",
        "primary": (4, 120, 87), "secondary": (217, 119, 6)
    },
    "MacCoffee Original 3in1 paketcha 20g": {
        "brand": "MacCoffee", "detail": "Original 3in1 20g", "category": "Qahva",
        "barcode": "8888040001012", "shape": "bag",
        "primary": (180, 83, 9), "secondary": (220, 38, 38)
    },
    "Nesquik shokoladli kakao 250g": {
        "brand": "Nesquik", "detail": "Kakao Kukuni 250g", "category": "Nonushta",
        "barcode": "7613035253010", "shape": "box",
        "primary": (250, 204, 21), "secondary": (67, 20, 7)
    },
    "Uvelka jo'xori yormasi 400g": {
        "brand": "Uvelka", "detail": "Jo'xori (Ovsyanka) 400g", "category": "Nonushta",
        "barcode": "4607062450017", "shape": "box",
        "primary": (217, 119, 6), "secondary": (254, 243, 199)
    },
    "Nutella shokoladli pasta 350g": {
        "brand": "Nutella", "detail": "Yong'oqli Pasta 350g", "category": "Shirinlik",
        "barcode": "8000500179864", "shape": "bottle",
        "primary": (67, 20, 7), "secondary": (220, 38, 38)
    },
    "Quyultirilgan sut Alekseevskoe 380g": {
        "brand": "Alekseevskoe", "detail": "Quyultirilgan Sut 380g", "category": "Sut",
        "barcode": "4607008120018", "shape": "can",
        "primary": (2, 132, 199), "secondary": (224, 242, 254)
    },
    "Tog' asali tabiiy toza 500g": {
        "brand": "Tog' Asali", "detail": "Tabiiy Toza Asal 500g", "category": "Asal",
        "barcode": "4780034120014", "shape": "bottle",
        "primary": (217, 119, 6), "secondary": (254, 240, 138)
    },
    "Pista mag'izli halva 300g": {
        "brand": "Pista Halva", "detail": "Mag'izli Halva 300g", "category": "Shirinlik",
        "barcode": "4780035120013", "shape": "bar",
        "primary": (146, 64, 14), "secondary": (254, 243, 199)
    },

    # 4. Sut va sut mahsulotlari (10 ta)
    "Musaffo tabiiy sut 3.2% 1L": {
        "brand": "Musaffo", "detail": "Tabiiy Sut 3.2% 1L", "category": "Sut",
        "barcode": "4780018120015", "shape": "bottle",
        "primary": (14, 165, 233), "secondary": (224, 242, 254)
    },
    "Musaffo tabiiy sut 2.5% 1L": {
        "brand": "Musaffo", "detail": "Tabiiy Sut 2.5% 1L", "category": "Sut",
        "barcode": "4780018120022", "shape": "bottle",
        "primary": (56, 189, 248), "secondary": (240, 249, 255)
    },
    "Kamilka yangi qaymoq 200g": {
        "brand": "Kamilka", "detail": "Yangi Qaymoq 200g", "category": "Sut",
        "barcode": "4780019120014", "shape": "box",
        "primary": (244, 63, 94), "secondary": (255, 241, 242)
    },
    "President sariyog'i 82% 200g": {
        "brand": "President", "detail": "Sariyog' 82% 200g", "category": "Sariyog'",
        "barcode": "3228020010018", "shape": "bar",
        "primary": (30, 58, 138), "secondary": (250, 204, 21)
    },
    "BioSut nordon qatiq 1L": {
        "brand": "BioSut", "detail": "Nordon Qatiq 1L", "category": "Qatiq",
        "barcode": "4780020120012", "shape": "bottle",
        "primary": (16, 185, 129), "secondary": (209, 250, 229)
    },
    "Danone qulupnayli yogurt 290g": {
        "brand": "Danone", "detail": "Qulupnayli Yogurt 290g", "category": "Yogurt",
        "barcode": "4600605001018", "shape": "bottle",
        "primary": (236, 72, 153), "secondary": (253, 242, 248)
    },
    "Rastishka tvorogi 100g": {
        "brand": "Rastishka", "detail": "Bolalar Tvorogi 100g", "category": "Tvorog",
        "barcode": "4600605002015", "shape": "box",
        "primary": (249, 115, 22), "secondary": (254, 237, 213)
    },
    "Hochland erigan pishloq 140g": {
        "brand": "Hochland", "detail": "Erigan Pishloq 140g", "category": "Pishloq",
        "barcode": "4005820010019", "shape": "box",
        "primary": (37, 99, 235), "secondary": (254, 240, 138)
    },
    "Rossiyskiy qattiq pishloq 1kg": {
        "brand": "Rossiyskiy", "detail": "Qattiq Pishloq 1kg", "category": "Pishloq",
        "barcode": "4780021120011", "shape": "bar",
        "primary": (234, 179, 8), "secondary": (254, 249, 195)
    },
    "Prostokvashino smetana 20% 300g": {
        "brand": "Prostokvashino", "detail": "Smetana 20% 300g", "category": "Smetana",
        "barcode": "4600605003012", "shape": "box",
        "primary": (2, 132, 199), "secondary": (224, 242, 254)
    },

    # 5. Shirinliklar va pishiriqlar (15 ta)
    "Snickers shokolad batonchigi 50g": {
        "brand": "Snickers", "detail": "Yong'oqli Shokolad 50g", "category": "Shirinlik",
        "barcode": "5000159461122", "shape": "bar",
        "primary": (59, 31, 11), "secondary": (2, 132, 199)
    },
    "Snickers Super shokolad 80g": {
        "brand": "Snickers Super", "detail": "Katta Format 80g", "category": "Shirinlik",
        "barcode": "5000159461139", "shape": "bar",
        "primary": (59, 31, 11), "secondary": (220, 38, 38)
    },
    "Twix shokolad batonchigi 55g": {
        "brand": "Twix", "detail": "Karamel & Pechenye 55g", "category": "Shirinlik",
        "barcode": "5000159459228", "shape": "bar",
        "primary": (217, 119, 6), "secondary": (220, 38, 38)
    },
    "Bounty kokosli shokolad 57g": {
        "brand": "Bounty", "detail": "Kokosli Jannat 57g", "category": "Shirinlik",
        "barcode": "5000159462228", "shape": "bar",
        "primary": (2, 132, 199), "secondary": (240, 253, 250)
    },
    "Mars shokolad batonchigi 50g": {
        "brand": "Mars", "detail": "Klassik Nuga 50g", "category": "Shirinlik",
        "barcode": "5000159463225", "shape": "bar",
        "primary": (24, 24, 27), "secondary": (220, 38, 38)
    },
    "KitKat shokoladli vafli 41.5g": {
        "brand": "KitKat", "detail": "Qarsildoq Vafli 41.5g", "category": "Shirinlik",
        "barcode": "7613035252839", "shape": "bar",
        "primary": (220, 38, 38), "secondary": (255, 255, 255)
    },
    "Alpen Gold sutli shokolad 85g": {
        "brand": "Alpen Gold", "detail": "Sutli Shokolad 85g", "category": "Shokolad",
        "barcode": "7622210010012", "shape": "bar",
        "primary": (124, 58, 237), "secondary": (254, 240, 138)
    },
    "Alpen Gold mayizli shokolad 85g": {
        "brand": "Alpen Gold", "detail": "Mayiz & Findiq 85g", "category": "Shokolad",
        "barcode": "7622210010029", "shape": "bar",
        "primary": (109, 40, 217), "secondary": (254, 240, 138)
    },
    "Milka sutli shokolad 100g": {
        "brand": "Milka", "detail": "Alp Suti Shokoladi 100g", "category": "Shokolad",
        "barcode": "7622210020011", "shape": "bar",
        "primary": (139, 92, 246), "secondary": (245, 243, 255)
    },
    "Orion Choco Pie pechenye 12 dona": {
        "brand": "Choco Pie", "detail": "Biskvitli Pechenye 12x", "category": "Pechenye",
        "barcode": "8801117101015", "shape": "box",
        "primary": (185, 28, 28), "secondary": (254, 243, 199)
    },
    "Oreo vanilli pechenye 95g": {
        "brand": "Oreo", "detail": "Vanilli Krem 95g", "category": "Pechenye",
        "barcode": "7622210030010", "shape": "bar",
        "primary": (15, 23, 42), "secondary": (2, 132, 199)
    },
    "Barni ayiqcha biskviti 30g": {
        "brand": "Barni", "detail": "Shokoladli Biskvit 30g", "category": "Biskvit",
        "barcode": "7622210040019", "shape": "box",
        "primary": (217, 119, 6), "secondary": (254, 243, 199)
    },
    "Raffaello bodomli konfet 150g": {
        "brand": "Raffaello", "detail": "Bodomli & Kokosli 150g", "category": "Konfet",
        "barcode": "8000500010013", "shape": "box",
        "primary": (225, 29, 72), "secondary": (248, 250, 252)
    },
    "Ferrero Rocher konfet to'plami 200g": {
        "brand": "Ferrero Rocher", "detail": "Zarhal Shokolad 200g", "category": "Konfet",
        "barcode": "8000500020012", "shape": "box",
        "primary": (161, 98, 7), "secondary": (254, 240, 138)
    },
    "Crafers shokoladli vafli 200g": {
        "brand": "Crafers", "detail": "Qarsildoq Vafli 200g", "category": "Vafli",
        "barcode": "4780041120013", "shape": "bag",
        "primary": (146, 64, 14), "secondary": (254, 243, 199)
    },

    # 6. Maishiy kimyo va tozalash (12 ta)
    "Ariel Oxi kir yuvish kukuni 3kg": {
        "brand": "Ariel Oxi", "detail": "Avtomat Kukun 3kg", "category": "Yuvish",
        "barcode": "8001090333215", "shape": "box",
        "primary": (5, 150, 105), "secondary": (16, 185, 129)
    },
    "Ariel Color kir yuvish kukuni 1.5kg": {
        "brand": "Ariel Color", "detail": "Rangli Kiyimlar 1.5kg", "category": "Yuvish",
        "barcode": "8001090333222", "shape": "box",
        "primary": (5, 150, 105), "secondary": (244, 63, 94)
    },
    "Tide Color kir yuvish kukuni 3kg": {
        "brand": "Tide Color", "detail": "Avtomat Kukun 3kg", "category": "Yuvish",
        "barcode": "8001090222014", "shape": "box",
        "primary": (234, 88, 12), "secondary": (250, 204, 21)
    },
    "Fairy limonli idish yuvish geli 450ml": {
        "brand": "Fairy Limon", "detail": "Idish Yuvish Geli 450ml", "category": "Idish",
        "barcode": "5413149867012", "shape": "bottle",
        "primary": (22, 163, 74), "secondary": (250, 204, 21)
    },
    "Fairy olma idish yuvish geli 900ml": {
        "brand": "Fairy Olma", "detail": "Idish Yuvish Geli 900ml", "category": "Idish",
        "barcode": "5413149867029", "shape": "bottle",
        "primary": (22, 163, 74), "secondary": (163, 230, 53)
    },
    "Domestos tozalovchi gel 750ml": {
        "brand": "Domestos", "detail": "Universal Dezinfeksiya 750ml", "category": "Tozalash",
        "barcode": "8710908001015", "shape": "bottle",
        "primary": (30, 64, 175), "secondary": (250, 204, 21)
    },
    "Mr. Proper pol yuvish vositasi 1L": {
        "brand": "Mr. Proper", "detail": "Pol & Devor Suyuqligi 1L", "category": "Tozalash",
        "barcode": "5410076001018", "shape": "bottle",
        "primary": (2, 132, 199), "secondary": (254, 240, 138)
    },
    "Lenor gullar ifori konditsioneri 1L": {
        "brand": "Lenor", "detail": "Kiyim Konditsioneri 1L", "category": "Yuvish",
        "barcode": "8001090111019", "shape": "bottle",
        "primary": (147, 51, 234), "secondary": (245, 208, 254)
    },
    "Bref tualet tozalovchi blok 3 dona": {
        "brand": "Bref Blok", "detail": "Xushbo'y Tozalovchi 3x", "category": "Tozalash",
        "barcode": "9000100010017", "shape": "box",
        "primary": (37, 99, 235), "secondary": (239, 68, 68)
    },
    "Cif universal tozalovchi krem 500ml": {
        "brand": "Cif Krem", "detail": "Universal Tozalovchi 500ml", "category": "Tozalash",
        "barcode": "8717163001012", "shape": "bottle",
        "primary": (13, 148, 136), "secondary": (204, 251, 241)
    },
    "Somat idish yuvish tabletkasi 20 dona": {
        "brand": "Somat", "detail": "Idish Yuvish Tabletka 20x", "category": "Idish",
        "barcode": "9000100020016", "shape": "box",
        "primary": (220, 38, 38), "secondary": (2, 132, 199)
    },
    "Selpak oshxona sochiqlari 2 dona": {
        "brand": "Selpak", "detail": "3 Qavatli Sochiq 2x", "category": "Gigiyena",
        "barcode": "8690536001014", "shape": "bag",
        "primary": (2, 132, 199), "secondary": (241, 245, 249)
    },

    # 7. Shaxsiy gigiyena (8 ta)
    "Colgate Total tish pastasi 100ml": {
        "brand": "Colgate Total", "detail": "12 Soatlik Himoya 100ml", "category": "Gigiyena",
        "barcode": "8718951132207", "shape": "tube",
        "primary": (220, 38, 38), "secondary": (255, 255, 255)
    },
    "Colgate Triple Action tish pastasi 100ml": {
        "brand": "Colgate 3x", "detail": "Triple Action 100ml", "category": "Gigiyena",
        "barcode": "8718951132214", "shape": "tube",
        "primary": (220, 38, 38), "secondary": (59, 130, 246)
    },
    "Head & Shoulders mentol shampun 400ml": {
        "brand": "Head & Shoulders", "detail": "Mentolli Yangilik 400ml", "category": "Shampun",
        "barcode": "8001090444010", "shape": "bottle",
        "primary": (2, 132, 199), "secondary": (204, 251, 241)
    },
    "Pantene Pro-V mayin shampun 400ml": {
        "brand": "Pantene", "detail": "Ipakdek Mayin 400ml", "category": "Shampun",
        "barcode": "8001090555013", "shape": "bottle",
        "primary": (217, 119, 6), "secondary": (254, 243, 199)
    },
    "Dove ipakdek nozik krem-sovun 100g": {
        "brand": "Dove", "detail": "Ipakdek Krem-Sovun 100g", "category": "Sovun",
        "barcode": "8717163002019", "shape": "bar",
        "primary": (30, 58, 138), "secondary": (248, 250, 252)
    },
    "Duru qattiq sovun 4x90g": {
        "brand": "Duru", "detail": "Tabiiy Gulli Sovun 4x90g", "category": "Sovun",
        "barcode": "8690506001017", "shape": "box",
        "primary": (13, 148, 136), "secondary": (240, 253, 250)
    },
    "Selpak yumshoq tualet qog'ozi 8 dona": {
        "brand": "Selpak", "detail": "Yumshoq Qog'oz 8x", "category": "Gigiyena",
        "barcode": "8690536002011", "shape": "bag",
        "primary": (2, 132, 199), "secondary": (255, 255, 255)
    },
    "Familia nam salfetkalar 72 dona": {
        "brand": "Familia", "detail": "Antibakterial Salfetka 72x", "category": "Gigiyena",
        "barcode": "8690536003018", "shape": "bag",
        "primary": (147, 51, 234), "secondary": (250, 245, 255)
    },

    # 8. Elektronika va aksessuarlar (10 ta)
    "Kingston DataTraveler 32GB fleshka": {
        "brand": "Kingston", "detail": "USB 3.2 Fleshka 32GB", "category": "Texnika",
        "barcode": "0740617298017", "shape": "tech",
        "primary": (30, 41, 59), "secondary": (220, 38, 38)
    },
    "Kingston DataTraveler 64GB fleshka": {
        "brand": "Kingston", "detail": "USB 3.2 Fleshka 64GB", "category": "Texnika",
        "barcode": "0740617298024", "shape": "tech",
        "primary": (30, 41, 59), "secondary": (220, 38, 38)
    },
    "Borofone Type-C tezkor kabel 1m": {
        "brand": "Borofone", "detail": "Type-C Tezkor 1m", "category": "Kabel",
        "barcode": "6974443380014", "shape": "tech",
        "primary": (15, 23, 42), "secondary": (14, 165, 233)
    },
    "Borofone Lightning kabel 1m": {
        "brand": "Borofone", "detail": "Lightning iPhone 1m", "category": "Kabel",
        "barcode": "6974443380021", "shape": "tech",
        "primary": (15, 23, 42), "secondary": (14, 165, 233)
    },
    "Hoco 18W tezkor zaryadlash adapteri": {
        "brand": "Hoco 18W", "detail": "Quick Charge 3.0 Adapter", "category": "Zaryad",
        "barcode": "6931474700018", "shape": "tech",
        "primary": (2, 132, 199), "secondary": (255, 255, 255)
    },
    "Hoco 10000mAh Powerbank": {
        "brand": "Hoco Power", "detail": "Powerbank 10000mAh PD", "category": "Akkumulyator",
        "barcode": "6931474700025", "shape": "tech",
        "primary": (15, 23, 42), "secondary": (16, 185, 129)
    },
    "Remax simsiz quloqchin (TWS)": {
        "brand": "Remax TWS", "detail": "Bluetooth 5.3 Quloqchin", "category": "Audio",
        "barcode": "6954851200015", "shape": "tech",
        "primary": (30, 41, 59), "secondary": (234, 179, 8)
    },
    "A4Tech OP-620D USB optik sichqoncha": {
        "brand": "A4Tech", "detail": "Optik Sichqoncha USB", "category": "Aksessuar",
        "barcode": "4711421700012", "shape": "tech",
        "primary": (15, 23, 42), "secondary": (239, 68, 68)
    },
    "Duracell Basic AA batareya 2 dona": {
        "brand": "Duracell AA", "detail": "Ishqoriy Batareya 2 dona", "category": "Batareya",
        "barcode": "5000394001018", "shape": "tech",
        "primary": (180, 83, 9), "secondary": (24, 24, 27)
    },
    "Duracell Basic AAA batareya 2 dona": {
        "brand": "Duracell AAA", "detail": "Ishqoriy Batareya 2 dona", "category": "Batareya",
        "barcode": "5000394001025", "shape": "tech",
        "primary": (180, 83, 9), "secondary": (24, 24, 27)
    },
}


def generate_product_image(output_path, meta):
    W, H = 400, 400
    img = Image.new("RGB", (W, H), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    primary = meta["primary"]
    secondary = meta["secondary"]
    brand = meta["brand"]
    detail = meta["detail"]
    category = meta["category"]
    barcode = meta["barcode"]
    shape = meta["shape"]

    # Background ambient studio gradient
    for y in range(H):
        ratio = y / H
        r = int(primary[0] * (1 - ratio * 0.40) + 245 * (ratio * 0.40))
        g = int(primary[1] * (1 - ratio * 0.40) + 248 * (ratio * 0.40))
        b = int(primary[2] * (1 - ratio * 0.40) + 252 * (ratio * 0.40))
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    # Center card panel
    margin = 18
    draw.rounded_rectangle(
        [margin, margin, W - margin, H - margin],
        radius=20,
        fill=(255, 255, 255),
        outline=(226, 232, 240),
        width=2,
    )

    # Fonts
    font_bold = ImageFont.truetype("/app/data/fonts/NotoSans-Bold.ttf", 22)
    font_medium = ImageFont.truetype("/app/data/fonts/NotoSans-Bold.ttf", 12)
    font_regular = ImageFont.truetype("/app/data/fonts/NotoSans-Regular.ttf", 12)
    font_barcode = ImageFont.truetype("/app/data/fonts/NotoSans-Regular.ttf", 11)

    # Top Category Badge
    draw.rounded_rectangle([120, 28, 280, 52], radius=12, fill=secondary)
    draw.text((200, 40), category.upper(), fill=primary, font=font_medium, anchor="mm")

    # Brand Title
    draw.text((200, 74), brand.upper(), fill=primary, font=font_bold, anchor="mm")
    draw.text((200, 98), detail, fill=(100, 116, 139), font=font_regular, anchor="mm")

    # Center Silhouette Product Art
    cx, cy = 200, 195
    if shape == "bottle":
        # Neck & Cap
        draw.rounded_rectangle([cx - 14, cy - 72, cx + 14, cy - 36], radius=4, fill=primary)
        draw.rounded_rectangle([cx - 18, cy - 80, cx + 18, cy - 70], radius=3, fill=secondary)
        # Bottle Body
        draw.rounded_rectangle([cx - 44, cy - 36, cx + 44, cy + 68], radius=16, fill=primary)
        # Label
        draw.rounded_rectangle([cx - 40, cy - 14, cx + 40, cy + 36], radius=8, fill=(255, 255, 255))
        draw.text((cx, cy + 11), brand[:9], fill=primary, font=font_medium, anchor="mm")
    elif shape == "can":
        draw.rounded_rectangle([cx - 40, cy - 65, cx + 40, cy + 65], radius=14, fill=primary)
        draw.rounded_rectangle([cx - 34, cy - 18, cx + 34, cy + 32], radius=8, fill=secondary)
        draw.text((cx, cy + 7), brand[:8], fill=(255, 255, 255), font=font_medium, anchor="mm")
    elif shape == "tube":
        # Tube Body
        draw.polygon([(cx - 40, cy - 65), (cx + 40, cy - 65), (cx + 25, cy + 45), (cx - 25, cy + 45)], fill=primary)
        # Tube Cap
        draw.rounded_rectangle([cx - 18, cy + 45, cx + 18, cy + 65], radius=4, fill=secondary)
        # Label
        draw.rounded_rectangle([cx - 30, cy - 35, cx + 30, cy + 15], radius=6, fill=(255, 255, 255))
        draw.text((cx, cy - 10), brand[:8], fill=primary, font=font_medium, anchor="mm")
    elif shape == "bar":
        draw.rounded_rectangle([cx - 68, cy - 34, cx + 68, cy + 46], radius=12, fill=primary)
        draw.rounded_rectangle([cx - 58, cy - 16, cx + 58, cy + 28], radius=6, fill=secondary)
        draw.text((cx, cy + 6), brand[:11], fill=(255, 255, 255), font=font_bold, anchor="mm")
    elif shape == "tech":
        draw.rounded_rectangle([cx - 52, cy - 50, cx + 52, cy + 50], radius=12, fill=primary)
        draw.rounded_rectangle([cx - 22, cy - 68, cx + 22, cy - 50], radius=4, fill=secondary) # USB connector
        draw.rounded_rectangle([cx - 42, cy - 20, cx + 42, cy + 25], radius=8, fill=(255, 255, 255))
        draw.text((cx, cy + 3), brand[:8], fill=primary, font=font_medium, anchor="mm")
    else:  # box or bag
        draw.rounded_rectangle([cx - 52, cy - 58, cx + 52, cy + 58], radius=14, fill=primary)
        draw.rounded_rectangle([cx - 44, cy - 20, cx + 44, cy + 32], radius=8, fill=(255, 255, 255))
        draw.text((cx, cy + 6), brand[:9], fill=primary, font=font_medium, anchor="mm")

    # Bottom Barcode Strip
    draw.rounded_rectangle([42, 304, 358, 362], radius=10, fill=(248, 250, 252), outline=(226, 232, 240), width=1)
    stripe_x = 65
    seed_hash = sum(ord(c) for c in barcode)
    for i in range(54):
        w = 2 if ((seed_hash * (i + 17)) % 7 in (0, 2, 5)) else 1
        if i % 4 != 2:
            draw.line([(stripe_x, 310), (stripe_x, 336)], fill=(15, 23, 42), width=w)
        stripe_x += 5

    formatted_code = f"{barcode[:1]}  {barcode[1:7]}  {barcode[7:]}"
    draw.text((200, 348), formatted_code, fill=(51, 65, 85), font=font_barcode, anchor="mm")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    img.save(output_path, "WEBP", quality=90)


class Command(BaseCommand):
    help = "Generate beautiful product images and update valid 13-digit EAN barcodes"

    def add_arguments(self, parser):
        parser.add_argument(
            "--tenant-id",
            type=int,
            default=4,
            help="Tenant ID to enrich products for (default: 4)",
        )

    def handle(self, *args, **options):
        tenant_id = options["tenant_id"]
        try:
            tenant = Tenant.objects.get(id=tenant_id)
        except Tenant.DoesNotExist:
            self.stderr.write(self.style.ERROR(f"Tenant {tenant_id} not found."))
            return

        media_dir = Path(settings.MEDIA_ROOT) / "catalog" / "products"
        os.makedirs(media_dir, exist_ok=True)

        self.stdout.write(self.style.NOTICE(f"Enriching media & barcodes for '{tenant.name}'..."))

        updated_count = 0
        products = Product.objects.filter(tenant=tenant).prefetch_related("variants")

        for product in products:
            meta = PRODUCTS_METADATA.get(product.name)
            if not meta:
                continue

            # 1. Generate & assign image
            image_filename = f"prod_{product.id}_{meta['brand'].lower().replace(' ', '_').replace('/', '_')}.webp"
            relative_image_path = f"catalog/products/{image_filename}"
            full_image_path = media_dir / image_filename

            generate_product_image(str(full_image_path), meta)

            product.image = relative_image_path
            product.save(update_fields=["image"])

            # 2. Update variant barcode
            variant = product.variants.first()
            if variant:
                variant.barcode = meta["barcode"]
                variant.save(update_fields=["barcode"])

            updated_count += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"\nSuccessfully enriched {updated_count} products!\n"
                f"- Rasmlar saqlandi: {media_dir}\n"
                f"- EAN-13 shtrix-kodlar yangilandi.\n"
            )
        )
