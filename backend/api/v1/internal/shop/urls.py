from django.urls import path

from api.v1.internal.shop.views import (
    ShopTenantProductDetailView,
    ShopTenantProductsView,
)

urlpatterns = [
    path(
        'tenants/<int:tenant_id>/products/',
        ShopTenantProductsView.as_view(),
        name='internal-shop-products',
    ),
    path(
        'tenants/<int:tenant_id>/products/<int:variant_id>/',
        ShopTenantProductDetailView.as_view(),
        name='internal-shop-product-detail',
    ),
]
