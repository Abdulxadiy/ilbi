from apps.core.readiness import readiness
from django.urls import include, path

urlpatterns = [
    path('sync/', include('apps.desktop_sync.urls')),
    path('workspace/', include('api.v1.workspace')),
    path('internal/health/ready/', readiness, name='internal-readiness'),
    path('support/', include('api.v1.support.urls')),
    path('', include('api.v1.accounts.urls')),
    path('', include('api.v1.tg_bot.urls')),
    path("tenants/", include('api.v1.tenants.urls')),
    path("catalog/", include('api.v1.catalog.urls')),
    path("inventory/", include('api.v1.inventory.urls')),
    path("sales/", include('api.v1.sales.urls')),
    path("analytics/", include('api.v1.analytics.urls')),
    path("cashbox/", include('api.v1.cashbox.urls')),
    path("audit/", include('api.v1.audit.urls')),
    path("internal/shop/", include('api.v1.internal.shop.urls')),
]

