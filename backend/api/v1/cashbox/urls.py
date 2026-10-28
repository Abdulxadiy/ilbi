from django.urls import path

from api.v1.cashbox.views.cashbox_views import (
    CashboxCapabilitiesView,
    CashExpenseListCreateView,
    CashIncomeListCreateView,
    CurrentShiftStatusView,
    DailyCashReportDetailView,
    DailyCashReportListView,
    ShiftCloseView,
    ShiftOpenView,
)

urlpatterns = [
    path('capabilities/', CashboxCapabilitiesView.as_view(), name='cashbox-capabilities'),
    path('expenses/', CashExpenseListCreateView.as_view(), name='cashbox-expenses'),
    path('income/', CashIncomeListCreateView.as_view(), name='cashbox-income'),
    path('shift/current/', CurrentShiftStatusView.as_view(), name='cashbox-shift-current'),
    path('shift/open/', ShiftOpenView.as_view(), name='cashbox-shift-open'),
    path('shift/close/', ShiftCloseView.as_view(), name='cashbox-shift-close'),
    path('reports/', DailyCashReportListView.as_view(), name='cashbox-reports-list'),
    path('reports/<int:pk>/', DailyCashReportDetailView.as_view(), name='cashbox-reports-detail'),
]
