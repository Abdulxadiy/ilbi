from django.urls import path
from api.v1.exports import StockExportView
from .views.batch_views import StockBatchListView, StockSupplierListView
from .views.operation_views import InventoryOperationsCapabilitiesView, InventoryTransferOptionsView

from .views.movement_views import (
    CustomerReturnCreateView,
    StockAdjustCreateView,
    StockBatchIntakeCreateView,
    StockIntakeCreateView,
    StockMovementListView,
    SupplierReturnCreateView,
    WriteOffCreateView,
)
from .views.stock_views import DeficitStockListView, StockDetailView, StockListView
from .views.transfer_views import (
    TenantTransferCloseDiscrepancyView,
    TenantTransferListCreateView,
    TenantTransferReceiveView,
    TenantTransferReturnView,
)

urlpatterns = [
    path("operations/capabilities/", InventoryOperationsCapabilitiesView.as_view(), name="inventory-operations-capabilities"),
    path("operations/transfer-options/", InventoryTransferOptionsView.as_view(), name="inventory-transfer-options"),
    path("stock/export/", StockExportView.as_view(), name="stock-export"),
    path("batches/", StockBatchListView.as_view(), name="stock-batches"),
    path("suppliers/", StockSupplierListView.as_view(), name="stock-suppliers"),
    path("stock/", StockListView.as_view(), name="stock-list"),
    path("stock/<int:product_variant_id>/", StockDetailView.as_view(), name="stock-detail"),
    path("deficits/", DeficitStockListView.as_view(), name="deficit-stock-list"),

    path("movements/", StockMovementListView.as_view(), name="movement-list"),
    path("intake/", StockIntakeCreateView.as_view(), name="stock-intake"),
    path("intake/batch/", StockBatchIntakeCreateView.as_view(), name="stock-batch-intake"),
    path("adjust/", StockAdjustCreateView.as_view(), name="stock-adjust"),
    path("customer-return/", CustomerReturnCreateView.as_view(), name="stock-customer-return"),
    path("supplier-return/", SupplierReturnCreateView.as_view(), name="stock-supplier-return"),
    path("write-off/", WriteOffCreateView.as_view(), name="stock-write-off"),
    path("transfers/", TenantTransferListCreateView.as_view(), name="tenant-transfer-list-create"),
    path("transfers/<int:transfer_id>/receive/", TenantTransferReceiveView.as_view(), name="tenant-transfer-receive"),
    path("transfers/<int:transfer_id>/return/", TenantTransferReturnView.as_view(), name="tenant-transfer-return"),
    path("transfers/<int:transfer_id>/close-discrepancy/", TenantTransferCloseDiscrepancyView.as_view(), name="tenant-transfer-close-discrepancy"),

]
