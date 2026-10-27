from django.urls import path
from api.v1.exports import SalesExportView, CounterpartyExportView

from api.v1.sales.views.b2b_views import (
    B2BAcceptView,
    B2BCapabilitiesView,
    B2BDetailView,
    B2BOutgoingListView,
    B2BMappingListView,
    B2BInboxListView,
    B2BRejectView,
    B2BReturnDiscrepancyCloseView,
    B2BReturnReceiveView,
)
from api.v1.sales.views.counterparty_views import (
    CounterpartyDetailView,
    CounterpartyListCreateView,
    CounterpartySalesListView,
    DebtPaymentCorrectionView,
    DebtPaymentListCreateView,
)
from api.v1.sales.views.notification_views import (
    NotificationDetailView,
    NotificationListView,
    NotificationReadView,
    NotificationReadAllView,
)
from api.v1.sales.views.import_views import (
    CounterpartyImportCommitView,
    CounterpartyImportPreviewView,
    CounterpartyImportTemplateView,
)
from api.v1.sales.views.sale_views import (
    PublicReceiptDetailView,
    SaleCapabilitiesView,
    SaleDetailView,
    SaleItemVoidView,
    SaleListCreateView,
    SaleReceiptTokenRotateView,
    SaleVoidView,
)

urlpatterns = [
    path("export/", SalesExportView.as_view(), name="sales-export"),
    path("counterparties/export/", CounterpartyExportView.as_view(), name="counterparties-export"),
    path("counterparties/import/template/", CounterpartyImportTemplateView.as_view(), name="counterparty-import-template"),
    path("counterparties/import/preview/", CounterpartyImportPreviewView.as_view(), name="counterparty-import-preview"),
    path("counterparties/import/<int:job_id>/commit/", CounterpartyImportCommitView.as_view(), name="counterparty-import-commit"),
    # Sales
    path("capabilities/", SaleCapabilitiesView.as_view(), name="sales-capabilities"),
    path("", SaleListCreateView.as_view(), name="sale-list-create"),
    path("public/receipt/<str:token>/", PublicReceiptDetailView.as_view(), name="public-receipt-detail"),
    path("<int:pk>/", SaleDetailView.as_view(), name="sale-detail"),
    path("<int:pk>/receipt-token/rotate/", SaleReceiptTokenRotateView.as_view(), name="sale-receipt-token-rotate"),
    path("<int:pk>/void/", SaleVoidView.as_view(), name="sale-void"),
    path("items/<int:pk>/void/", SaleItemVoidView.as_view(), name="sale-item-void"),
    # Counterparties & Debt
    path("counterparties/", CounterpartyListCreateView.as_view(), name="counterparty-list-create"),
    path("counterparties/<int:pk>/", CounterpartyDetailView.as_view(), name="counterparty-detail"),
    path(
        "counterparties/<int:counterparty_id>/sales/",
        CounterpartySalesListView.as_view(),
        name="counterparty-sales-list",
    ),
    path(
        "counterparties/<int:counterparty_id>/payments/",
        DebtPaymentListCreateView.as_view(),
        name="debt-payment-list-create",
    ),
    path(
        "counterparties/<int:counterparty_id>/payments/correct/",
        DebtPaymentCorrectionView.as_view(),
        name="debt-payment-correct",
    ),
    # B2B
    path("b2b/mapping/<str:kind>/", B2BMappingListView.as_view(), name="b2b-mapping"),
    path("b2b/capabilities/", B2BCapabilitiesView.as_view(), name="b2b-capabilities"),
    path("b2b/outgoing/", B2BOutgoingListView.as_view(), name="b2b-outgoing-list"),
    path("b2b/<int:sale_id>/", B2BDetailView.as_view(), name="b2b-detail"),
    path("b2b/inbox/", B2BInboxListView.as_view(), name="b2b-inbox-list"),
    path("b2b/<int:sale_id>/accept/", B2BAcceptView.as_view(), name="b2b-accept"),
    path("b2b/<int:sale_id>/reject/", B2BRejectView.as_view(), name="b2b-reject"),
    path("b2b/<int:sale_id>/returns/receive/", B2BReturnReceiveView.as_view(), name="b2b-return-receive"),
    path(
        "b2b/<int:sale_id>/returns/close-discrepancy/",
        B2BReturnDiscrepancyCloseView.as_view(),
        name="b2b-return-discrepancy-close",
    ),
    # Notifications
    path("notifications/read-all/", NotificationReadAllView.as_view(), name="notification-read-all"),
    path("notifications/", NotificationListView.as_view(), name="notification-list"),
    path("notifications/<int:pk>/", NotificationDetailView.as_view(), name="notification-detail"),
    path("notifications/<int:pk>/read/", NotificationReadView.as_view(), name="notification-read"),
]
