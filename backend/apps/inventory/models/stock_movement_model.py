from django.db import models
from apps.core.models import BaseModel


class StockMovement(BaseModel):
    TYPE_KIRIM = "kirim"
    TYPE_SOTUV = "sotuv"
    TYPE_MIJOZ_QAYTARDI = "mijoz_qaytardi"
    TYPE_YETKAZIB_BERUVCHIGA_QAYTARISH = "yetkazib_beruvchiga_qaytarish"
    TYPE_ISROFGARCHILIK = "isrofgarchilik"
    TYPE_TUZATISH = "tuzatish"
    TYPE_SALE_RESTORE = "sotuv_qaytarildi"
    TYPE_TENANT_TRANSFER_OUT = "tenant_transfer_out"
    TYPE_TENANT_TRANSFER_IN = "tenant_transfer_in"
    TYPE_TENANT_TRANSFER_RETURN_OUT = "transfer_return_out"
    TYPE_TENANT_TRANSFER_RETURN_IN = "transfer_return_in"

    TYPE_CHOICES = [
        (TYPE_KIRIM, "Kirim"),
        (TYPE_SOTUV, "Sotuv"),
        (TYPE_MIJOZ_QAYTARDI, "Mijoz qaytardi"),
        (TYPE_YETKAZIB_BERUVCHIGA_QAYTARISH, "Yetkazib beruvchiga qaytarish"),
        (TYPE_ISROFGARCHILIK, "Isrofgarchilik"),
        (TYPE_TUZATISH, "Tuzatish"),
        (TYPE_SALE_RESTORE, "Sotuv bekor qilindi (qaytarildi)"),
        (TYPE_TENANT_TRANSFER_OUT, "Tenantlararo transfer chiqimi"),
        (TYPE_TENANT_TRANSFER_IN, "Tenantlararo transfer kirimi"),
        (TYPE_TENANT_TRANSFER_RETURN_OUT, "Qaytish transferi chiqimi"),
        (TYPE_TENANT_TRANSFER_RETURN_IN, "Qaytish transferi kirimi"),
    ]

    DIRECTION_IN = "in"
    DIRECTION_OUT = "out"
    DIRECTION_CHOICES = [
        (DIRECTION_IN, "Kirim"),
        (DIRECTION_OUT, "Chiqim"),
    ]

    product_variant = models.ForeignKey(
        "catalog.ProductVariant",
        on_delete=models.PROTECT,
        related_name="stock_movements",
    )
    type = models.CharField(max_length=32, choices=TYPE_CHOICES)
    direction = models.CharField(max_length=3, choices=DIRECTION_CHOICES)

    quantity = models.DecimalField(max_digits=14, decimal_places=3)
    cost_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    note = models.TextField(blank=True)
    supplier = models.CharField(max_length=255, blank=True, db_index=True)

    sale = models.ForeignKey(
        "sales.Sale",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="stock_movements",
    )

    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.PROTECT, related_name="stock_movements"
    )


    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(quantity__gt=0), name="stock_movement_quantity_positive"
            ),
        ]
        ordering = ["-created_at"]


    def __str__(self):
        sign = "+" if self.direction == self.DIRECTION_IN else "-"
        return f"{self.product_variant} | {sign}{self.quantity} ({self.type})"
