"""Public product description captured with the sale, without cost/private data."""


def product_snapshot(variant):
    return {
        "version": 1,
        "product_name": variant.product.name,
        "product_variant_name": variant.name,
        "product_code": variant.code,
        "product_sku": variant.sku,
        "product_barcode": variant.barcode,
        "unit": variant.unit,
        "mxik": variant.mxik,
        "package_code": variant.package_code,
    }
