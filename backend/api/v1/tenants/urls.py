"""URL routes for the tenants API."""

from django.urls import path

from api.v1.accounts.views.employee_management_views import (
    EmployeeAccountStatusView,
    EmployeeDetailView,
    EmployeePermissionChoicesView,
    EmployeeResendInvitationView,
    EmployeeRestoreView,
)
from api.v1.accounts.views.employee_views import EmployeeFireView, EmployeeHireView, EmployeeListView

from .views import (
    CurrentTenantView,
    MyTenantSellerProfileView,
    MyTenantsView,
    SellerProfileListCreateView,
    SellerProfileReviewQueueView,
    SellerProfileReviewView,
    SellerProfileUpdateView,
    TenantActivateView,
    TenantChangeOwnerView,
    TenantDeactivateView,
    TenantDetailView,
    TenantListCreateView,
    TenantResendOwnerInviteView,
    TenantSendLowStockReportNowView,
    TenantSendReportNowView,
    TenantTestTelegramView,
    TenantTransferTargetsView,
)

urlpatterns = [
    path("", TenantListCreateView.as_view(), name="tenant-list-create"),
    path("my/", MyTenantsView.as_view(), name="tenant-my-list-create"),
    path("my/<int:tenant_id>/seller-profile/", MyTenantSellerProfileView.as_view(), name="tenant-my-seller-profile"),
    path("seller-profiles/", SellerProfileListCreateView.as_view(), name="seller-profile-list-create"),
    path("seller-profiles/review/", SellerProfileReviewQueueView.as_view(), name="seller-profile-review-queue"),
    path("seller-profiles/<int:pk>/", SellerProfileUpdateView.as_view(), name="seller-profile-update"),
    path("seller-profiles/<int:pk>/review/", SellerProfileReviewView.as_view(), name="seller-profile-review"),
    path("current/", CurrentTenantView.as_view(), name="tenant-current"),
    path("current/transfer-targets/", TenantTransferTargetsView.as_view(), name="tenant-transfer-targets"),
    path("current/test-telegram/", TenantTestTelegramView.as_view(), name="tenant-test-telegram"),
    path("current/send-report-now/", TenantSendReportNowView.as_view(), name="tenant-send-report-now"),
    path("current/send-low-stock-report-now/", TenantSendLowStockReportNowView.as_view(), name="tenant-send-low-stock-report-now"),
    path("<int:pk>/", TenantDetailView.as_view(), name="tenant-detail"),
    path("<int:pk>/change-owner/", TenantChangeOwnerView.as_view(), name="tenant-change-owner"),
    path(
        "<int:pk>/resend-owner-invite/",
        TenantResendOwnerInviteView.as_view(),
        name="tenant-resend-owner-invite",
    ),
    path("<int:pk>/deactivate/", TenantDeactivateView.as_view(), name="tenant-deactivate"),
    path("<int:pk>/activate/", TenantActivateView.as_view(), name="tenant-activate"),
    path("<int:tenant_id>/employees/", EmployeeListView.as_view(), name="tenant-employee-list"),
    path("<int:tenant_id>/employees/permissions/", EmployeePermissionChoicesView.as_view(), name="tenant-employee-permissions"),
    path("<int:tenant_id>/employees/hire/", EmployeeHireView.as_view(), name="tenant-employee-hire"),
    path("<int:tenant_id>/employees/fire/", EmployeeFireView.as_view(), name="tenant-employee-fire"),
    path("<int:tenant_id>/employees/<int:employee_id>/", EmployeeDetailView.as_view(), name="tenant-employee-detail"),
    path("<int:tenant_id>/employees/<int:employee_id>/account-status/", EmployeeAccountStatusView.as_view(), name="tenant-employee-account-status"),
    path("<int:tenant_id>/employees/<int:employee_id>/resend-invite/", EmployeeResendInvitationView.as_view(), name="tenant-employee-resend-invite"),
    path("<int:tenant_id>/employees/<int:employee_id>/restore/", EmployeeRestoreView.as_view(), name="tenant-employee-restore"),
]
