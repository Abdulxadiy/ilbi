from django.urls import path

from api.v1.audit.history_views import HistoryDetailView, HistoryListView
from api.v1.audit.views import AuditLogListView

urlpatterns = [
    path("history/", HistoryListView.as_view(), name="history-list"),
    path("history/<str:source>/<int:pk>/", HistoryDetailView.as_view(), name="history-detail"),
    path("logs/", AuditLogListView.as_view(), name="audit-log-list"),
]
